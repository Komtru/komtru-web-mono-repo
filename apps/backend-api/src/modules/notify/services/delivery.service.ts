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
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { NotificationCategory, NotificationChannel } from '@komtru/shared-types';
import type { Db } from '../../../db/index.js';
import { publish } from '../../../platform/events/publish.js';
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

/** The status update, the attempt row and the event are one transaction: they cannot disagree. */
export async function markSent(
  db: Db,
  claimed: ClaimedNotification,
  providerReference: string | undefined,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(notifications)
      .set({
        status: 'SENT',
        sentAt: new Date(),
        ...(providerReference === undefined ? {} : { providerReference }),
      })
      .where(eq(notifications.id, claimed.id));
    await tx.insert(notificationDeliveryAttempts).values({
      notificationId: claimed.id,
      attemptNumber: claimed.attemptNumber,
      succeeded: true,
    });
    await publish(tx, notificationSent, { payload: payloadOf(claimed), ...aggregate(claimed) });
  });
}

export async function markFailed(db: Db, claimed: ClaimedNotification, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(notifications)
      .set({ status: 'FAILED', failedReason: reason })
      .where(eq(notifications.id, claimed.id));
    await tx.insert(notificationDeliveryAttempts).values({
      notificationId: claimed.id,
      attemptNumber: claimed.attemptNumber,
      succeeded: false,
      errorDetail: reason,
    });
    await publish(tx, notificationFailed, {
      payload: { ...payloadOf(claimed), reason, attempt: claimed.attemptNumber },
      ...aggregate(claimed),
    });
  });
}

/** The end of the line. Ops alerting consumes this; T-100 opens a ticket for the SECURITY ones. */
export async function markDeadLettered(db: Db, claimed: ClaimedNotification, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(notifications)
      .set({ status: 'DEAD_LETTERED', failedReason: reason })
      .where(eq(notifications.id, claimed.id));
    await tx.insert(notificationDeliveryAttempts).values({
      notificationId: claimed.id,
      attemptNumber: claimed.attemptNumber,
      succeeded: false,
      errorDetail: reason,
    });
    await publish(tx, notificationDeadLettered, {
      payload: { ...payloadOf(claimed), reason, attempts: claimed.attemptNumber },
      ...aggregate(claimed),
    });
  });
}

export interface StuckOptions {
  /** How long a QUEUED row may sit before we assume its enqueue was lost. */
  queuedAfterMs: number;
  /** How long a SENDING row may sit before we assume the worker holding it died. */
  sendingAfterMs: number;
}

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
      and(inArray(notifications.status, ['QUEUED', 'FAILED']), lt(notifications.queuedAt, queuedBefore)),
    );

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
