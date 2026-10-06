// M11 §4.3. One row per attempted send, and the attempt history behind it.
import { sql } from 'drizzle-orm';
import { bigserial, boolean, check, index, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { notify } from './columns.js';
import { notificationCategory, notificationChannel, notificationStatus } from './enums.js';

export const notifications = notify.table(
  'notifications',
  {
    /**
     * Deterministic: uuid v5 over (eventId, templateKey, channel, userId) — see domain/identity.ts.
     * This primary key IS the idempotency boundary. A redelivered event, a retried handler and two
     * bindings racing all land on this row, and the send job claims it before any provider is
     * touched, so the user gets one SMS however many times the pipeline runs.
     */
    id: uuid('id').primaryKey(),
    /** Soft reference to identity.users(id): cross-schema references are plain uuid (design §4.2). */
    userId: uuid('user_id').notNull(),
    /** The outbox event this send traces back to. M11 D1: there is no send without one. */
    eventId: uuid('event_id').notNull(),
    eventName: text('event_name').notNull(),
    templateKey: text('template_key').notNull(),
    /** Which version of the copy the user actually got, for "what did we tell them" questions. */
    templateVersion: integer('template_version').notNull(),
    channel: notificationChannel('channel').notNull(),
    category: notificationCategory('category').notNull(),
    status: notificationStatus('status').notNull().default('QUEUED'),
    renderedSubject: text('rendered_subject'),
    renderedBody: text('rendered_body').notNull(),
    /**
     * `j•••@gmail.com`, `+23480•••5678`, `devices:2`. The address itself is never copied out of
     * identity: it can change, and a second copy of everyone's phone number is a second thing to
     * leak. The send job re-reads the real destination.
     */
    recipientMasked: text('recipient_masked'),
    providerReference: text('provider_reference'),
    /** Bumped by the claim, so the cap is the database's answer and not the queue's. */
    attemptCount: integer('attempt_count').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    /** IN_APP only: `POST /notifications/:id/mark-read` (M11 §7). */
    readAt: timestamp('read_at', { withTimezone: true }),
    failedReason: text('failed_reason'),
    /** Ties one event's multi-channel fan-out together; the event id, so support can work backwards. */
    correlationId: uuid('correlation_id'),
  },
  (table) => [
    // A suppressed row with no reason cannot answer the only question it exists to answer.
    check(
      'notifications_suppressed_has_reason',
      sql`${table.status} <> 'SUPPRESSED' OR ${table.failedReason} IS NOT NULL`,
    ),
    // nullsFirst(): `ORDER BY queued_at DESC` is DESC NULLS FIRST, and an index built NULLS LAST
    // cannot serve it.
    index('notifications_user_idx').on(table.userId, table.queuedAt.desc().nullsFirst()),
    index('notifications_status_idx')
      .on(table.status)
      .where(sql`${table.status} IN ('QUEUED', 'SENDING', 'FAILED')`),
    index('notifications_correlation_idx').on(table.correlationId),
    // The in-app feed's only query. Partial, so it stays the size of the feed, not of every send.
    index('notifications_feed_idx')
      .on(table.userId, table.queuedAt.desc().nullsFirst())
      .where(sql`${table.channel} = 'IN_APP'`),
  ],
);

/**
 * Append-only (migration 0017): this is the evidence that a user was or was not told, and evidence
 * that can be rewritten is not evidence.
 */
export const notificationDeliveryAttempts = notify.table(
  'notification_delivery_attempts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
    succeeded: boolean('succeeded').notNull(),
    errorDetail: text('error_detail'),
  },
  (table) => [index('notification_delivery_attempts_notif_idx').on(table.notificationId)],
);
