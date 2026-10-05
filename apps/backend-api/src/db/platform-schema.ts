// Schema for cross-module database plumbing: the append-only trigger function (T-021) and the
// transactional outbox (design §4.3). Module tables never live here.
import { sql } from 'drizzle-orm';
import {
  bigserial,
  customType,
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

/** Postgres's 64-bit transaction id. The relay compares it against the current snapshot's xmin. */
const xid8 = customType<{ data: string; driverData: string }>({ dataType: () => 'xid8' });

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
    /**
     * The transaction that wrote the row. `seq` is handed out at INSERT, so a slow transaction can
     * commit a lower seq after a faster one; the relay publishes a row only once this xid is older
     * than every transaction still running, after which no older row can still appear.
     */
    createdXid: xid8('created_xid')
      .notNull()
      .default(sql`pg_current_xact_id()`),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The relay's only query. Partial, so the index stays the size of the backlog, not the table.
    index('outbox_unpublished_idx')
      .on(table.seq)
      .where(sql`${table.publishedAt} IS NULL`),
    // Only the pruner reads this, and only published rows: partial, so the hot insert path pays
    // nothing for it.
    index('outbox_published_at_idx')
      .on(table.publishedAt)
      .where(sql`${table.publishedAt} IS NOT NULL`),
  ],
);

/**
 * One row per idempotency key (design §4.4): claimed before the handler runs and completed with the
 * response, so a client that retries a mutating call over a flaky connection gets the first
 * answer back instead of a second trade, payout or custody event.
 */
export const idempotencyKeys = platform.table(
  'idempotency_keys',
  {
    /** The route's session scope: one client's key cannot collide with another scope's. */
    scope: text('scope').notNull(),
    /** The client's `Idempotency-Key` header, verbatim. */
    key: text('key').notNull(),
    /** `user:<uuid>` once sessions exist (T-030), `anon` until then. */
    actor: text('actor').notNull(),
    /** Hash of method, path and body: the same key with a different request is a client bug. */
    requestHash: text('request_hash').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    status: integer('status'),
    response: jsonb('response'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.key, table.actor] }),
    index('idempotency_keys_created_at_idx').on(table.createdAt),
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
