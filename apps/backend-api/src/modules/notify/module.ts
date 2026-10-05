// The notify module: subscribers, send queues, the stuck sweep and the consumer routes.
//
// start() checks the catalogue BEFORE it syncs or subscribes, so a template that declares a
// variable its body never uses, or a mapping with no template, stops the process at boot naming the
// offender — rather than at 2am when the first user hits it.
import type { KomtruModule, ModuleContext } from '../../platform/module.js';
import type { Db } from '../../db/index.js';
import type { NotifyConfig } from '../../config/env.js';
import type { Logger } from '../../platform/logger.js';
import type { QueueFactory } from '../../platform/queue/factory.js';
import { CATALOGUE, assertCatalogueIntegrity, type NotificationCatalogue } from './domain/catalogue.js';
import { BINDINGS, type NotificationBinding } from './domain/binding.js';
import { SEND_QUEUES, enqueueSend } from './jobs/enqueue.js';
import { runSendJob, type SendJobData } from './jobs/send.job.js';
import { requeueStuck } from './jobs/requeue-stuck.job.js';
import { dispatchForEvent } from './services/dispatch.service.js';
import { notifyRoutes } from './http/routes.js';
import { syncCatalogue } from './services/sync.service.js';

/** How many sends of one channel run at once. A provider, not the database, is the bottleneck. */
const SEND_CONCURRENCY = 4;

interface NotifyRuntime {
  db: Db;
  queues: QueueFactory;
  config: NotifyConfig;
  logger: Logger;
}

export interface NotifyModuleOptions {
  bindings?: NotificationBinding[];
  catalogue?: NotificationCatalogue;
}

export function createNotifyModule(options: NotifyModuleOptions = {}): KomtruModule {
  const bindings = options.bindings ?? BINDINGS;
  const catalogue = options.catalogue ?? CATALOGUE;

  // Populated by start(). The queue definitions have to exist on the module object before start
  // runs (the api defines them, the worker consumes them), but no job runs until queues.run(),
  // which is after start — so by the time a `process` function is called this is always set.
  let runtime: NotifyRuntime | undefined;
  const need = (): NotifyRuntime => {
    if (!runtime) throw new Error('notify: the module has not started');
    return runtime;
  };

  const sendQueue = (name: string) => ({
    name,
    concurrency: SEND_CONCURRENCY,
    process: (data: SendJobData) => runSendJob(need(), data),
  });

  return {
    name: 'notify',

    routes: notifyRoutes(() => need().db),

    // One queue per channel, so a stalled Termii cannot hold up email. Attempts and backoff are
    // per job (see jobs/enqueue.ts), because the api defines these before it has the config.
    queues: [sendQueue(SEND_QUEUES.EMAIL), sendQueue(SEND_QUEUES.SMS), sendQueue(SEND_QUEUES.PUSH)],

    schedules: [
      {
        name: 'notify.requeue-stuck',
        cron: '* * * * *',
        description: 'Re-enqueues notifications whose send job was lost or abandoned',
        handler: (firedAt) => requeueStuck(need(), firedAt),
      },
    ],

    start: async (ctx: ModuleContext) => {
      const config = ctx.config.notify;
      // First, and before anything is written or subscribed.
      assertCatalogueIntegrity(catalogue, config.defaultLocale);
      runtime = { db: ctx.db, queues: ctx.queues, config, logger: ctx.logger };

      const synced = await syncCatalogue(ctx.db, catalogue);
      if (synced.templates || synced.mappings) {
        ctx.logger.info(synced, 'notify: catalogue synced');
      }

      for (const binding of bindings) {
        ctx.events.subscribe({
          name: binding.subscriber,
          event: binding.event,
          handler: async (envelope, tx) => {
            const queued = await dispatchForEvent({ config, logger: ctx.logger }, tx, {
              envelope,
              templateKey: binding.templateKey,
              recipients: binding.recipients(envelope.payload),
            });
            // Enqueued inside the handler's transaction for latency, and allowed to fail: an
            // enqueue is not transactional, so `notify.requeue-stuck` is the floor underneath it.
            // Throwing here would roll back the rows AND the processed_events marker, so the whole
            // dispatch would be redone — which is safe (the ids are deterministic) but pointless.
            for (const target of queued) {
              try {
                await enqueueSend(ctx.queues, config, target);
              } catch (error) {
                ctx.logger.error(
                  { err: error, notificationId: target.notificationId },
                  'notify: enqueue failed, the sweep will pick it up',
                );
              }
            }
          },
        });
      }
    },

    stop: () => {
      runtime = undefined;
      return Promise.resolve();
    },
  };
}

export const notifyModule = createNotifyModule();
