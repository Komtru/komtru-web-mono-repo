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
  type ClaimedNotification,
} from '../services/delivery.service.js';
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

/** Why this channel is not sending for real, or undefined when it is. */
function dryRunReason(config: NotifyConfig, channel: NotificationChannel): string | undefined {
  if (PHONE_CHANNELS.includes(channel)) {
    if (config.smsDryRun) return 'NOTIFY_SMS_DRY_RUN';
    if (!config.termii) return 'TERMII credentials absent';
    return undefined;
  }
  if (channel === 'PUSH') {
    if (config.pushDryRun) return 'NOTIFY_PUSH_DRY_RUN';
    if (!config.fcm) return 'FCM credentials absent';
    return undefined;
  }
  if (channel === 'EMAIL') return config.mailjet ? undefined : 'MAILJET credentials absent';
  return undefined;
}

export async function runSendJob(deps: SendJobDeps, data: SendJobData): Promise<void> {
  const { db, config, logger } = deps;
  const claimed = await claimForSend(db, data.notificationId);
  if (!claimed) {
    // Already sent, suppressed, dead-lettered, in flight elsewhere — or the dispatching
    // transaction rolled back after the enqueue, so the row was never committed. None of those is
    // this job's problem, and none of them is worth a dead letter.
    logger.info({ notificationId: data.notificationId }, 'notify: nothing to claim');
    return;
  }

  const destination = await resolveDestination(db, claimed.userId, claimed.channel);
  if (!destination) {
    // The address went away between dispatch and send. Deterministic, so retrying is pointless.
    await markDeadLettered(db, claimed, 'no destination at send time');
    throw new UnrecoverableError(`notify: ${claimed.id} has no destination for ${claimed.channel}`);
  }

  const dryRun = dryRunReason(config, claimed.channel);
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
    await markSent(db, claimed, DRY_RUN_REFERENCE);
    return;
  }

  try {
    const { providerReference } = await deliver(deps, claimed, destination.address);
    await markSent(db, claimed, providerReference);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown provider failure';
    if (claimed.attemptNumber >= config.maxAttempts) {
      await markDeadLettered(db, claimed, reason);
      // Unrecoverable: the attempt cap is the notification's, and burning the queue's remaining
      // backoffs only delays the alert an operator needs now.
      throw new UnrecoverableError(
        `notify: ${claimed.id} dead-lettered after ${String(claimed.attemptNumber)} attempts: ${reason}`,
      );
    }
    await markFailed(db, claimed, reason);
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

  if (PHONE_CHANNELS.includes(claimed.channel)) {
    const termii = config.termii;
    if (!termii || !first) throw new Error('notify: sms send reached without a recipient or credentials');
    return sendSms(logger, { ...termii, to: first, text: claimed.renderedBody });
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
