// The worker process: runs background work (BullMQ queues and schedules, added in T-023) in its own
// process, so a slow job never blocks the API's event loop.
import { loadConfig } from './config/env.js';
import { assertNotOwner } from './db/index.js';
import { modules as registry } from './modules/index.js';
import { createClients } from './platform/clients.js';
import { createLogger } from './platform/logger.js';
import { createQueueFactory } from './platform/queue/factory.js';
import { createScheduleRegistry } from './platform/scheduler/registry.js';
import { startScheduler, type RunningScheduler } from './platform/scheduler/scheduler.js';
import { moduleClosers, type KomtruModule } from './platform/module.js';
import { initSentry } from './platform/sentry.js';
import type { RunningProcess } from './platform/run.js';
import { gracefulShutdown } from './platform/shutdown.js';

export type RunningWorker = RunningProcess;

export async function startWorker(
  env: NodeJS.ProcessEnv,
  modules: KomtruModule[] = registry,
): Promise<RunningWorker> {
  const config = loadConfig(env);
  const logger = createLogger(config, { process: 'worker' });
  const sentry = initSentry(config, 'worker');
  const clients = createClients(config);
  try {
    await assertNotOwner(clients.pool);
  } catch (error) {
    await clients.close();
    throw error;
  }

  const queues = createQueueFactory({ redisUrl: config.redis.url, logger });
  let scheduler: RunningScheduler | undefined;
  try {
    const registry = createScheduleRegistry();
    for (const module of modules) {
      for (const definition of module.queues ?? []) queues.consume(definition);
      for (const job of module.schedules ?? []) registry.register(job);
    }
    for (const module of modules) await module.start?.({ queues });
    scheduler = await startScheduler({
      registry,
      redisUrl: config.redis.url,
      timezone: config.scheduler.timezone,
      logger,
    });
  } catch (error) {
    // Nothing was consumed yet (consumers start only below); release everything that was opened.
    await gracefulShutdown({
      closers: [
        { name: 'queues', close: () => queues.close() },
        ...moduleClosers(modules),
        { name: 'clients', close: () => clients.close() },
      ],
      timeoutMs: 10_000,
      logger,
    });
    throw error;
  }
  queues.run();
  const runningScheduler = scheduler;
  logger.info('worker started');

  const reportFatal = (error: unknown, origin: string) => {
    logger.fatal({ err: error, origin }, 'fatal error');
    sentry.captureException(error);
  };

  return {
    reportFatal,
    stop: () =>
      gracefulShutdown({
        // Stop taking work first, so in-flight jobs finish against live modules and connections.
        closers: [
          { name: 'scheduler', close: () => runningScheduler.stop() },
          { name: 'queues', close: () => queues.close() },
          ...moduleClosers(modules),
          { name: 'clients', close: () => clients.close() },
          { name: 'sentry', close: async () => void (await sentry.flush()) },
        ],
        timeoutMs: 30_000,
        logger,
      }),
  };
}
