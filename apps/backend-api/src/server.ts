// The API process: load config, connect, start modules, listen, and shut down in reverse.
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { modules as registry } from './modules/index.js';
import { createClients, postgresCheck, redisCheck } from './platform/clients.js';
import { healthRoutes } from './platform/health.js';
import { createLogger } from './platform/logger.js';
import { moduleHealthChecks, mountModules, type KomtruModule } from './platform/module.js';
import { initSentry } from './platform/sentry.js';
import { gracefulShutdown, type Closer, type ShutdownResult } from './platform/shutdown.js';

export interface RunningApi {
  server: Server;
  stop(): Promise<ShutdownResult>;
}

const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Stops modules in reverse start order. */
export const stopModules = (modules: KomtruModule[]): Closer => ({
  name: 'modules',
  async close() {
    for (const module of [...modules].reverse()) await module.stop?.();
  },
});

export async function startApi(
  env: NodeJS.ProcessEnv,
  modules: KomtruModule[] = registry,
): Promise<RunningApi> {
  const config = loadConfig(env);
  const logger = createLogger(config, { process: 'api' });
  const sentry = initSentry(config, 'api');
  const clients = createClients(config);

  for (const module of modules) await module.start?.();

  const app = createApp({
    config,
    logger,
    mountV1: mountModules(modules),
    mountRoot: healthRoutes([
      postgresCheck(clients.pool),
      redisCheck(clients.redis),
      ...moduleHealthChecks(modules),
    ]),
    onUnexpected: (error) => sentry.captureException(error),
  });

  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(config.port, () => resolve(listening));
  });
  // Longer than a typical load balancer's idle timeout, so the LB closes idle connections first.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  logger.info({ port: config.port }, 'api listening');

  const closeServer: Closer = {
    name: 'http',
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };

  return {
    server,
    stop: () =>
      gracefulShutdown({
        closers: [
          closeServer,
          stopModules(modules),
          { name: 'clients', close: () => clients.close() },
          { name: 'sentry', close: async () => void (await sentry.flush()) },
        ],
        timeoutMs: SHUTDOWN_TIMEOUT_MS,
        logger,
      }),
  };
}
