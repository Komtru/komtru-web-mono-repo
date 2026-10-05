// The API process: load config, connect, start modules, listen, and shut down in reverse.
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { assertNotOwner, createDb } from './db/index.js';
import { modules as registry } from './modules/index.js';
import { createClients, postgresCheck, redisCheck } from './platform/clients.js';
import { healthRoutes } from './platform/health.js';
import { createLogger } from './platform/logger.js';
import { createEventBus } from './platform/events/bus.js';
import { createInProcessEmitter } from './platform/events/emitter.js';
import { createQueueFactory } from './platform/queue/factory.js';
import { moduleClosers, moduleHealthChecks, mountModules, type KomtruModule } from './platform/module.js';
import { initSentry } from './platform/sentry.js';
import type { RunningProcess } from './platform/run.js';
import { gracefulShutdown, type Closer } from './platform/shutdown.js';

export interface RunningApi extends RunningProcess {
  server: Server;
}

const SHUTDOWN_TIMEOUT_MS = 10_000;
/** In-flight requests get this long to finish before their connections are forced closed. */
const HTTP_DRAIN_TIMEOUT_MS = 5_000;

export async function startApi(
  env: NodeJS.ProcessEnv,
  modules: KomtruModule[] = registry,
): Promise<RunningApi> {
  const config = loadConfig(env);
  const logger = createLogger(config, { process: 'api' });
  const sentry = initSentry(config, 'api');
  const clients = createClients(config);
  try {
    await assertNotOwner(clients.pool);
  } catch (error) {
    await clients.close();
    throw error;
  }

  // Producer side only: the API never consumes, so slow jobs never touch the request event loop.
  // The same goes for events: the API publishes to the outbox and defines the subscriber queues, but
  // the relay and every handler run in the worker.
  const queues = createQueueFactory({ redisUrl: config.redis.url, logger });
  const db = createDb(clients.pool);
  const events = createEventBus({ db, queues, logger, role: 'api' });
  const emitter = createInProcessEmitter(logger);
  for (const definition of modules.flatMap((m) => m.queues ?? [])) queues.define(definition);
  try {
    for (const module of modules) await module.start?.({ queues, events, emitter, db });
  } catch (error) {
    await gracefulShutdown({
      closers: [
        ...moduleClosers(modules),
        { name: 'queues', close: () => queues.close() },
        { name: 'clients', close: () => clients.close() },
      ],
      timeoutMs: SHUTDOWN_TIMEOUT_MS,
      logger,
    });
    throw error;
  }

  let draining = false;
  const app = createApp({
    config,
    logger,
    isDraining: () => draining,
    mountV1: mountModules(modules),
    mountRoot: healthRoutes([
      postgresCheck(clients.pool),
      redisCheck(clients.redis),
      ...moduleHealthChecks(modules),
    ]),
    onUnexpected: (error) => sentry.captureException(error),
  });

  const releaseResources: Closer[] = [
    ...moduleClosers(modules),
    { name: 'queues', close: () => queues.close() },
    { name: 'clients', close: () => clients.close() },
    { name: 'sentry', close: async () => void (await sentry.flush()) },
  ];

  let server: Server;
  try {
    server = await new Promise<Server>((resolve, reject) => {
      const listening = app.listen(config.port, (error?: Error) =>
        error ? reject(error) : resolve(listening),
      );
    });
  } catch (error) {
    // e.g. EADDRINUSE: release what was opened, then let the caller exit non-zero.
    await gracefulShutdown({ closers: releaseResources, timeoutMs: SHUTDOWN_TIMEOUT_MS, logger });
    throw error;
  }
  // Longer than a typical load balancer's idle timeout, so the LB closes idle connections first.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  logger.info({ port: config.port }, 'api listening');

  /**
   * Stop accepting connections and let in-flight requests finish. While draining, every response
   * carries `Connection: close`, so a keep-alive socket closes right after its last request instead
   * of holding the server open until its idle timeout. Anything still open after the drain deadline
   * is closed forcibly, so the closers after this one always get to run.
   */
  const drainHttp: Closer = {
    name: 'http',
    close: () =>
      new Promise((resolve, reject) => {
        draining = true;
        const force = setTimeout(() => server.closeAllConnections(), HTTP_DRAIN_TIMEOUT_MS);
        server.close((error) => {
          clearTimeout(force);
          if (error) reject(error);
          else resolve();
        });
        server.closeIdleConnections();
      }),
  };

  const reportFatal = (error: unknown, origin: string) => {
    logger.fatal({ err: error, origin }, 'fatal error');
    sentry.captureException(error);
  };

  return {
    reportFatal,
    server,
    stop: () =>
      gracefulShutdown({ closers: [drainHttp, ...releaseResources], timeoutMs: SHUTDOWN_TIMEOUT_MS, logger }),
  };
}
