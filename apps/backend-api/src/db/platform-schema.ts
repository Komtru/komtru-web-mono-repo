// Schema for cross-module database plumbing: the append-only trigger function (T-021) and the
// transactional outbox (design §4.3). Module tables never live here.
import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const platform = pgSchema('platform');

/**
 * One row per domain event, written in the same transaction as the state change that caused it.
 * The relay (worker only) publishes unpublished rows to subscriber queues in `seq` order and sets
 * `published_at`. Rows are pruned once published and past the retention window.
 */
export const outbox = platform.table(
  'outbox',
  {
    /** Publication order. Bigserial, not the uuid, so ordering survives clock skew. */
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    eventId: uuid('event_id').notNull().unique(),
    eventType: text('event_type').notNull(),
    version: integer('version').notNull(),
    /** The thing the event is about; per-aggregate order is the only order the relay promises. */
    aggregateType: text('aggregate_type'),
    aggregateId: uuid('aggregate_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    correlationId: uuid('correlation_id'),
    causationId: uuid('causation_id'),
    actor: jsonb('actor').notNull(),
    payload: jsonb('payload').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The relay's only query. Partial, so the index stays the size of the backlog, not the table.
    index('outbox_unpublished_idx')
      .on(table.seq)
      .where(sql`${table.publishedAt} IS NULL`),
    index('outbox_published_at_idx').on(table.publishedAt),
  ],
);

/**
 * What each subscriber has already handled. Written inside the handler's own transaction, so a
 * handler that throws rolls its marker back and the redelivery runs it again.
 */
export const processedEvents = platform.table(
  'processed_events',
  {
    eventId: uuid('event_id').notNull(),
    /** `module.handler`, e.g. `ledger.on-trade-completed`. */
    subscriber: text('subscriber').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.subscriber] }),
    index('processed_events_processed_at_idx').on(table.processedAt),
  ],
);
