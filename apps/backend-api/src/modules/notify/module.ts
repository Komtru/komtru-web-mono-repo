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
import { missingCredential, runSendJob, type SendJobData } from './jobs/send.job.js';
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
      assertChannelsCanSend(catalogue, config, ctx.config.nodeEnv, ctx.logger);
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
            // Returned, not awaited here: the bus runs this once the rows above are committed.
            // Enqueueing inside the transaction raced it — the send job would find no row, throw
            // "is not committed yet", and burn an attempt; with a small attempt budget both tries
            // could land early and dead-letter a notification that was never going to fail.
            //
            // Still allowed to fail, for the same reason as before: an enqueue is not
            // transactional, and `notify.requeue-stuck` is the floor underneath it.
            return async () => {
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
            };
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

/**
 * Every channel the shipped catalogue uses must either have its provider configured or be in dry
 * run. Checked at boot so a rotated key that never reached the deployment is a refusal to start
 * naming the variable, rather than every OTP that night quietly dead-lettering at send time.
 *
 * Outside production this only warns: a developer who has no FCM credentials and no reason to care
 * should still be able to boot, and the dry-run defaults already mean nothing is sent.
 */
function assertChannelsCanSend(
  catalogue: NotificationCatalogue,
  config: NotifyConfig,
  nodeEnv: string,
  logger: Logger,
): void {
  const channels = new Set(catalogue.templates.map((t) => t.channel));
  const problems = [...channels]
    .map((channel) => ({ channel, missing: missingCredential(config, channel) }))
    .filter((entry) => entry.missing !== undefined)
    .map((entry) => `${entry.channel}: ${String(entry.missing)}`);
  if (!problems.length) return;
  const message = `notify: ${String(problems.length)} channel(s) cannot send:\n  ${problems.join('\n  ')}`;
  if (nodeEnv === 'production') throw new Error(message);
  logger.warn({ channels: problems }, 'notify: some channels cannot send; they will dead-letter');
}
