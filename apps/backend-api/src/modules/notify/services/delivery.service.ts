// The state machine around one notification row, and the guard that makes "exactly once" true for
// the thing the user actually sees.
//
// The outbox and platform.processed_events already stop a redelivered EVENT from being dispatched
// twice. They do not stop a SEND JOB from running twice: BullMQ keeps a failed job for 30 days, an
// operator can retry one by hand, and a worker killed mid-send leaves a job to be retried. So the
// provider call is gated on a conditional UPDATE instead — one statement, so two workers racing on
// the same row cannot both win. Whoever moves the row out of QUEUED sends; everybody else goes home.
//
// What this buys is at-most-once per claim on top of the queue's at-least-once, which is the
// strongest honest guarantee: a provider call that succeeded but whose response never reached us
// still looks like a failure, and `releaseStuck` will eventually hand it out again. That window is
// `sendingAfterMs` wide and deliberate — a notification nobody ever retries is worse than one a
// user occasionally sees twice.
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { NotificationCategory, NotificationChannel } from '@komtru/shared-types';
import type { Db } from '../../../db/index.js';
import type { Logger } from '../../../platform/logger.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { notificationDeadLettered, notificationFailed, notificationSent } from '../domain/events.js';
import { notificationDeliveryAttempts, notifications } from '../infrastructure/postgres/schema/index.js';

export interface ClaimedNotification {
  id: string;
  userId: string;
  channel: NotificationChannel;
  category: NotificationCategory;
  templateKey: string;
  renderedSubject: string | null;
  renderedBody: string;
  recipientMasked: string | null;
  /** Which attempt this claim is. The cap is checked against it, not against BullMQ's counter. */
  attemptNumber: number;
}

/**
 * Moves a notification to SENDING and returns everything the job needs, or returns undefined when
 * somebody else already has it (or it is already sent, suppressed or dead-lettered).
 */
export async function claimForSend(db: Db, notificationId: string): Promise<ClaimedNotification | undefined> {
  const rows = await db
    .update(notifications)
    .set({
      status: 'SENDING',
      attemptCount: sql`${notifications.attemptCount} + 1`,
      lastAttemptAt: new Date(),
    })
    .where(and(eq(notifications.id, notificationId), inArray(notifications.status, ['QUEUED', 'FAILED'])))
    .returning({
      id: notifications.id,
      userId: notifications.userId,
      channel: notifications.channel,
      category: notifications.category,
      templateKey: notifications.templateKey,
      renderedSubject: notifications.renderedSubject,
      renderedBody: notifications.renderedBody,
      recipientMasked: notifications.recipientMasked,
      attemptNumber: notifications.attemptCount,
    });
  return rows[0];
}

/**
 * Writes an outcome back, but only if this caller still holds the claim.
 *
 * The guard is what makes "whoever claims, sends" true. Without it a worker that stalled past the
 * sweep's window, lost its row to the sweep and then to a second worker, could still come back and
 * flip a row that is already SENT to FAILED — publishing `notification.failed` for a message the
 * user received, and leaving the sweep a row to hand out a third time. Zero rows updated means the
 * claim was taken over while we were talking to a provider: the new holder owns the outcome, so
 * this attempt records nothing and publishes nothing.
 *
 * The update, the attempt row and the event are one transaction: they cannot disagree.
 */
async function finish(
  db: Db,
  claimed: ClaimedNotification,
  logger: Logger,
  outcome: {
    status: 'SENT' | 'FAILED' | 'DEAD_LETTERED';
    succeeded: boolean;
    reason?: string;
    providerReference?: string;
  },
  publishEvent: (tx: Tx) => Promise<unknown>,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(notifications)
      .set({
        status: outcome.status,
        ...(outcome.status === 'SENT' ? { sentAt: new Date() } : {}),
        ...(outcome.reason === undefined ? {} : { failedReason: outcome.reason }),
        ...(outcome.providerReference === undefined ? {} : { providerReference: outcome.providerReference }),
      })
      .where(
        and(
          eq(notifications.id, claimed.id),
          eq(notifications.status, 'SENDING'),
          eq(notifications.attemptCount, claimed.attemptNumber),
        ),
      )
      .returning({ id: notifications.id });

    if (!updated.length) {
      logger.warn(
        { notificationId: claimed.id, attempt: claimed.attemptNumber, outcome: outcome.status },
        'notify: claim was taken over, dropping this attempt outcome',
      );
      return false;
    }

    await tx.insert(notificationDeliveryAttempts).values({
      notificationId: claimed.id,
      attemptNumber: claimed.attemptNumber,
      succeeded: outcome.succeeded,
      ...(outcome.reason === undefined ? {} : { errorDetail: outcome.reason }),
    });
    await publishEvent(tx);
    return true;
  });
}

/**
 * Whether the row is committed at all. The send job needs to tell "somebody else already handled
 * this" from "the dispatching transaction has not committed yet", because only the second is worth
 * retrying.
 */
export async function notificationExists(db: Db, notificationId: string): Promise<boolean> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .limit(1);
  return rows.length > 0;
}

/** Returns false when the claim had already been taken over, so nothing was recorded. */
export async function markSent(
  db: Db,
  claimed: ClaimedNotification,
  providerReference: string | undefined,
  logger: Logger,
): Promise<boolean> {
  return finish(
    db,
    claimed,
    logger,
    { status: 'SENT', succeeded: true, ...(providerReference === undefined ? {} : { providerReference }) },
    (tx) => publish(tx, notificationSent, { payload: payloadOf(claimed), ...aggregate(claimed) }),
  );
}

export async function markFailed(
  db: Db,
  claimed: ClaimedNotification,
  reason: string,
  logger: Logger,
): Promise<boolean> {
  return finish(db, claimed, logger, { status: 'FAILED', succeeded: false, reason }, (tx) =>
    publish(tx, notificationFailed, {
      payload: { ...payloadOf(claimed), reason, attempt: claimed.attemptNumber },
      ...aggregate(claimed),
    }),
  );
}

/** The end of the line. Ops alerting consumes this; T-100 opens a ticket for the SECURITY ones. */
export async function markDeadLettered(
  db: Db,
  claimed: ClaimedNotification,
  reason: string,
  logger: Logger,
): Promise<boolean> {
  return finish(db, claimed, logger, { status: 'DEAD_LETTERED', succeeded: false, reason }, (tx) =>
    publish(tx, notificationDeadLettered, {
      payload: { ...payloadOf(claimed), reason, attempts: claimed.attemptNumber },
      ...aggregate(claimed),
    }),
  );
}

export interface StuckOptions {
  /** How long a QUEUED row may sit before we assume its enqueue was lost. */
  queuedAfterMs: number;
  /** How long a SENDING or FAILED row may sit untouched before its queue is presumed gone. */
  sendingAfterMs: number;
  limit?: number;
}

/** One minute's worth of rescues. A backlog drains over several ticks rather than in one burst. */
export const DEFAULT_RELEASE_LIMIT = 500;

export interface ReleasedNotification {
  notificationId: string;
  channel: NotificationChannel;
}

/**
 * The floor under the enqueue. Returns the rows to put back on a queue: QUEUED ones left alone (the
 * enqueue never landed — Redis was down, or the handler's transaction committed and the process
 * died before `add`) and SENDING ones a killed worker abandoned, which go back to FAILED so the
 * claim will hand them out again.
 */
export async function releaseStuck(
  db: Db,
  now: Date,
  options: StuckOptions,
): Promise<ReleasedNotification[]> {
  const queuedBefore = new Date(now.getTime() - options.queuedAfterMs);
  const sendingBefore = new Date(now.getTime() - options.sendingAfterMs);

  const abandoned = await db
    .update(notifications)
    .set({ status: 'FAILED', failedReason: 'worker stopped before the send finished' })
    .where(and(eq(notifications.status, 'SENDING'), lt(notifications.lastAttemptAt, sendingBefore)))
    .returning({ notificationId: notifications.id, channel: notifications.channel });

  const waiting = await db
    .select({ notificationId: notifications.id, channel: notifications.channel })
    .from(notifications)
    .where(
      or(
        // Never enqueued, or the enqueue was lost: nothing has ever attempted it.
        and(eq(notifications.status, 'QUEUED'), lt(notifications.queuedAt, queuedBefore)),
        // FAILED is the ORDINARY resting state between two of BullMQ's own retries, so it must be
        // judged on the last attempt, never on `queued_at`. Keying it on creation time would make
        // the sweep add a second job alongside a retry chain that is still waiting out its backoff
        // — two live jobs for one notification, a provider call each, and the attempt budget spent
        // in a third of the time. Only a FAILED row whose last attempt is as old as an abandoned
        // SENDING one has genuinely lost its queue.
        and(eq(notifications.status, 'FAILED'), lt(notifications.lastAttemptAt, sendingBefore)),
      ),
    )
    .orderBy(notifications.queuedAt)
    // Bounded: after an incident this must not try to re-enqueue the whole backlog every minute.
    .limit(options.limit ?? DEFAULT_RELEASE_LIMIT);

  // A row the UPDATE above just released is already in `abandoned`: filtered here rather than in
  // SQL, because the set is small and an `<> ALL($1::uuid[])` on an empty array is a trap.
  const released = new Set(abandoned.map((row) => row.notificationId));
  return [...abandoned, ...waiting.filter((row) => !released.has(row.notificationId))];
}

const payloadOf = (claimed: ClaimedNotification) => ({
  notificationId: claimed.id,
  userId: claimed.userId,
  channel: claimed.channel,
  category: claimed.category,
  templateKey: claimed.templateKey,
});

const aggregate = (claimed: ClaimedNotification) => ({
  aggregateType: 'notification',
  aggregateId: claimed.id,
});
