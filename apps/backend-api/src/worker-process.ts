// The worker process: runs background work (BullMQ queues and schedules, added in T-023) in its own
// process, so a slow job never blocks the API's event loop.
import { loadConfig } from './config/env.js';
import { modules as registry } from './modules/index.js';
import { createClients } from './platform/clients.js';
import { createLogger } from './platform/logger.js';
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

  for (const module of modules) await module.start?.();
  logger.info('worker started');

  const reportFatal = (error: unknown, origin: string) => {
    logger.fatal({ err: error, origin }, 'fatal error');
    sentry.captureException(error);
  };

  return {
    reportFatal,
    stop: () =>
      gracefulShutdown({
        closers: [
          ...moduleClosers(modules),
          { name: 'clients', close: () => clients.close() },
          { name: 'sentry', close: async () => void (await sentry.flush()) },
        ],
        timeoutMs: 30_000,
        logger,
      }),
  };
}
