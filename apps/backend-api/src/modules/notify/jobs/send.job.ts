// The only place a notification reaches a provider (design §4.4): a BullMQ job, in the worker,
// never in a request.
//
// The order below is the whole safety argument:
//   1. claim the row — one conditional UPDATE. No row back means somebody else sent it, or there is
//      nothing to send. Either way we return quietly: throwing would dead-letter a job whose work
//      is already done.
//   2. resolve the destination now, not at dispatch time, so a user who fixed their phone number
//      five minutes ago gets the message at the number they have.
//   3. the dry-run gate, BEFORE any client is called. This is the structural half of "no real SMS
//      outside production": the decision lives here, in a file the provider-clients rule keeps
//      free of network code, and the client below is simply never reached.
import { UnrecoverableError } from 'bullmq';
import type { NotificationChannel } from '@komtru/shared-types';
import type { NotifyConfig } from '../../../config/env.js';
import type { Db } from '../../../db/index.js';
import type { Logger } from '../../../platform/logger.js';
import {
  claimForSend,
  markDeadLettered,
  markFailed,
  markSent,
  notificationExists,
  type ClaimedNotification,
} from '../services/delivery.service.js';
import { allowsUnverifiedDestination, phoneTargetFor } from '../domain/binding.js';
import { resolveDestination } from '../services/recipients.service.js';
import { sendEmail } from '../infrastructure/providers/mailjet.client.js';
import { sendPush } from '../infrastructure/providers/fcm.client.js';
import { sendSms } from '../infrastructure/providers/termii.client.js';

export interface SendJobData {
  notificationId: string;
}

export interface SendJobDeps {
  db: Db;
  config: NotifyConfig;
  logger: Logger;
}

/** What a dry run records, so a support query can tell it from a real send. */
export const DRY_RUN_REFERENCE = 'dry-run';

const PHONE_CHANNELS: readonly NotificationChannel[] = ['SMS', 'WHATSAPP', 'VOICE'];

/**
 * Which environment variable is holding this channel back, or undefined when it sends for real.
 *
 * ONLY the dry-run flags. A missing credential is deliberately NOT treated as a dry run: recording
 * `SENT` for an OTP nobody sent is worse than recording nothing, because the delivery record then
 * actively lies to the support agent reading it, and no `notification.failed` ever fires for ops to
 * see. A channel whose provider is not configured dead-letters instead — see `missingCredential`.
 */
function dryRunFlag(config: NotifyConfig, channel: NotificationChannel): string | undefined {
  if (PHONE_CHANNELS.includes(channel)) return config.smsDryRun ? 'NOTIFY_SMS_DRY_RUN' : undefined;
  if (channel === 'PUSH') return config.pushDryRun ? 'NOTIFY_PUSH_DRY_RUN' : undefined;
  return undefined;
}

/** The variables this channel needs and does not have. A misconfiguration, not an outage. */
export function missingCredential(config: NotifyConfig, channel: NotificationChannel): string | undefined {
  if (PHONE_CHANNELS.includes(channel)) return config.termii ? undefined : 'TERMII_* not configured';
  if (channel === 'PUSH') return config.fcm ? undefined : 'FCM_* not configured';
  if (channel === 'EMAIL') return config.mailjet ? undefined : 'MAILJET_* not configured';
  return undefined;
}

export async function runSendJob(deps: SendJobDeps, data: SendJobData): Promise<void> {
  const { db, config, logger } = deps;
  const claimed = await claimForSend(db, data.notificationId);
  if (!claimed) {
    // Two very different situations, and only one of them is fine.
    if (await notificationExists(db, data.notificationId)) {
      // Already SENT, SUPPRESSED, DEAD_LETTERED, or in flight on another worker. Nothing to do.
      logger.info({ notificationId: data.notificationId }, 'notify: nothing to claim');
      return;
    }
    // The row is not committed yet. The enqueue happens inside the dispatching transaction, so a
    // job can — and routinely does — reach a worker microseconds before the COMMIT lands. Throwing
    // puts it back with BullMQ's exponential backoff, which converges in milliseconds; returning
    // quietly would leave the user waiting for the once-a-minute sweep's two-minute window, which
    // on an OTP is a failed login. If the transaction genuinely rolled back, the retries exhaust
    // and the queue dead-letters the job, which is the visible signal an operator wants.
    throw new Error(`notify: ${data.notificationId} is not committed yet`);
  }

  // The same allowance dispatch used, derived from the same column, so a row cannot be QUEUED at
  // dispatch and dead-letter here for a reason that never changed.
  const destination = await resolveDestination(db, claimed.userId, claimed.channel, {
    allowUnverified: allowsUnverifiedDestination(claimed.templateKey),
    phoneTarget: phoneTargetFor(claimed.templateKey),
  });
  if (!destination) {
    // The address went away between dispatch and send. Deterministic, so retrying is pointless.
    await markDeadLettered(db, claimed, 'no destination at send time', logger);
    throw new UnrecoverableError(`notify: ${claimed.id} has no destination for ${claimed.channel}`);
  }

  const missing = missingCredential(config, claimed.channel);
  if (missing !== undefined) {
    // Loud, and visible to ops and to T-100: nothing was delivered, and the record says so.
    await markDeadLettered(db, claimed, missing, logger);
    throw new UnrecoverableError(`notify: ${claimed.channel} cannot send, ${missing}`);
  }

  const dryRun = dryRunFlag(config, claimed.channel);
  if (dryRun !== undefined) {
    logger.info(
      {
        notificationId: claimed.id,
        channel: claimed.channel,
        reason: dryRun,
        // The masked form, never the address: a dry-run log is still a log.
        recipient: claimed.recipientMasked,
      },
      'notify: dry run, no provider call',
    );
    await markSent(db, claimed, DRY_RUN_REFERENCE, logger);
    return;
  }

  try {
    const { providerReference } = await deliver(deps, claimed, destination.address);
    await markSent(db, claimed, providerReference, logger);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown provider failure';
    if (claimed.attemptNumber >= config.maxAttempts) {
      await markDeadLettered(db, claimed, reason, logger);
      // Unrecoverable: the attempt cap is the notification's, and burning the queue's remaining
      // backoffs only delays the alert an operator needs now.
      throw new UnrecoverableError(
        `notify: ${claimed.id} dead-lettered after ${String(claimed.attemptNumber)} attempts: ${reason}`,
      );
    }
    await markFailed(db, claimed, reason, logger);
    throw error;
  }
}

async function deliver(
  deps: SendJobDeps,
  claimed: ClaimedNotification,
  address: string[],
): Promise<{ providerReference: string | undefined }> {
  const { config, logger } = deps;
  const [first] = address;

  if (claimed.channel === 'EMAIL') {
    const mailjet = config.mailjet;
    if (!mailjet || !first) throw new Error('notify: email send reached without a recipient or credentials');
    return sendEmail(logger, {
      ...mailjet,
      to: first,
      subject: claimed.renderedSubject ?? '',
      text: claimed.renderedBody,
    });
  }

  if (claimed.channel === 'SMS') {
    const termii = config.termii;
    if (!termii || !first) throw new Error('notify: sms send reached without a recipient or credentials');
    return sendSms(logger, { ...termii, to: first, text: claimed.renderedBody });
  }

  if (claimed.channel === 'WHATSAPP' || claimed.channel === 'VOICE') {
    // In the enum (M11 §4.1) and routed to the SMS queue so the dry-run gate covers them, but with
    // no adapter. Silently delivering one as a plain SMS would bill for a channel the user did not
    // choose and make the ticket's own deferral note false.
    throw new UnrecoverableError(`notify: ${claimed.channel} has no adapter yet`);
  }

  if (claimed.channel === 'PUSH') {
    const fcm = config.fcm;
    if (!fcm) throw new Error('notify: push send reached without credentials');
    const result = await sendPush(logger, {
      ...fcm,
      tokens: address,
      title: claimed.renderedSubject ?? 'Komtru',
      body: claimed.renderedBody,
    });
    if (result.invalidTokens.length) {
      // M1 owns devices.push_token, so notify reports rather than writes; T-031 retires them.
      logger.warn(
        { notificationId: claimed.id, count: result.invalidTokens.length },
        'notify: fcm rejected device tokens',
      );
    }
    return result;
  }

  // IN_APP never reaches a job (dispatch records it SENT), so this is a programming error.
  throw new UnrecoverableError(`notify: no adapter for channel ${claimed.channel}`);
}
