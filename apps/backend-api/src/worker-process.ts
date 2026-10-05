// The worker process: runs background work (BullMQ queues and schedules, added in T-023) in its own
// process, so a slow job never blocks the API's event loop.
import { queueDeadLetteredEvent } from '@komtru/shared-types';
import { loadConfig } from './config/env.js';
import { assertNotOwner, createDb } from './db/index.js';
import { modules as registry } from './modules/index.js';
import { createClients } from './platform/clients.js';
import { createLogger } from './platform/logger.js';
import { createEventBus } from './platform/events/bus.js';
import { createInProcessEmitter } from './platform/events/emitter.js';
import { publishInOwnTransaction } from './platform/events/publish.js';
import { startOutboxRelay, type RunningRelay } from './platform/events/relay.js';
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

  const db = createDb(clients.pool);
  // A dead-lettered job is the ops event T-023 left as a hook: published in its own transaction,
  // because there is no state change to ride along with, and never allowed to fail the worker.
  const queues = createQueueFactory({
    redisUrl: config.redis.url,
    logger,
    onDeadLetter: (letter) => {
      void publishInOwnTransaction(db, queueDeadLetteredEvent, {
        payload: {
          queue: letter.queue,
          jobId: letter.jobId,
          name: letter.name,
          attempts: letter.attempts,
          error: letter.error,
          failedAt: letter.failedAt,
        },
      }).catch((error: unknown) =>
        logger.error({ err: error, queue: letter.queue }, 'events: dead-letter event not published'),
      );
    },
  });
  const events = createEventBus({ db, queues, logger, role: 'worker' });
  const emitter = createInProcessEmitter(logger);
  let scheduler: RunningScheduler | undefined;
  let relay: RunningRelay | undefined;
  try {
    const registry = createScheduleRegistry();
    for (const module of modules) {
      for (const definition of module.queues ?? []) queues.consume(definition);
      for (const job of module.schedules ?? []) registry.register(job);
    }
    for (const module of modules) await module.start?.({ queues, events, emitter, db });
    scheduler = await startScheduler({
      registry,
      redisUrl: config.redis.url,
      timezone: config.scheduler.timezone,
      logger,
    });
    // Started last: every subscriber is registered by now, so no event is relayed to a queue
    // nobody consumes yet.
    relay = startOutboxRelay({ db, bus: events, queues, logger });
  } catch (error) {
    // Nothing was consumed yet (consumers start only below); release everything that was opened.
    await gracefulShutdown({
      // The relay is started on the last line of the try, so it cannot be running here.
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
  const runningRelay = relay;
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
          { name: 'events-relay', close: () => runningRelay.stop() },
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
