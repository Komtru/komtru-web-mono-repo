// Putting a notification on its channel's queue.
//
// One queue per channel, so a stalled Termii cannot hold up email. Attempts and backoff are passed
// per job rather than declared on the queue: the API defines its queues before start(), where the
// configuration is not yet in hand, and NOTIFY_MAX_ATTEMPTS is the number that matters.
//
// No provider import here, so this stays callable from the module's start() and from the scheduled
// sweep (komtru/provider-clients only restricts *.client.ts).
import type { NotificationChannel } from '@komtru/shared-types';
import type { NotifyConfig } from '../../../config/env.js';
import type { QueueFactory } from '../../../platform/queue/factory.js';
import type { SendJobData } from './send.job.js';

export const SEND_QUEUES = {
  EMAIL: 'notify.send-email',
  SMS: 'notify.send-sms',
  PUSH: 'notify.send-push',
} as const;

export type SendQueueName = (typeof SEND_QUEUES)[keyof typeof SEND_QUEUES];

/** WHATSAPP and VOICE share the SMS queue: same provider, same failure mode, same backoff. */
export function queueForChannel(channel: NotificationChannel): SendQueueName | undefined {
  if (channel === 'EMAIL') return SEND_QUEUES.EMAIL;
  if (channel === 'PUSH') return SEND_QUEUES.PUSH;
  if (channel === 'SMS' || channel === 'WHATSAPP' || channel === 'VOICE') return SEND_QUEUES.SMS;
  // IN_APP has no provider: dispatch records it SENT and there is nothing to enqueue.
  return undefined;
}

export interface EnqueueTarget {
  notificationId: string;
  channel: NotificationChannel;
}

export interface EnqueueOptions {
  /**
   * False for the stuck sweep. The first enqueue uses the notification id as the job id, so a
   * handler that is retried after its enqueue succeeded does not create a second job. The sweep
   * must not: BullMQ keeps a failed job for 30 days, and re-adding its id is silently ignored —
   * which would make the sweep a no-op for exactly the rows it exists to rescue. Sending twice is
   * not a risk either way; the claim in delivery.service.ts is what guarantees one provider call.
   */
  deduplicate?: boolean;
}

export async function enqueueSend(
  queues: QueueFactory,
  config: NotifyConfig,
  target: EnqueueTarget,
  options: EnqueueOptions = {},
): Promise<void> {
  const name = queueForChannel(target.channel);
  if (!name) return;
  const { deduplicate = true } = options;
  await queues.producer<SendJobData>(name).add(
    'send',
    { notificationId: target.notificationId },
    {
      ...(deduplicate ? { jobId: target.notificationId } : {}),
      attempts: config.maxAttempts,
      backoff: { type: 'exponential', delay: config.retryBaseDelayMs },
    },
  );
}
