// Delivery signals (M7 §4.4, trust-weighted in §6) and the scheduled deadlines design §6.2 names.
// The weighting itself — which source may move a trade to INSPECTION rather than
// UNCONFIRMED_DELIVERY, and the partner-history exception — is T-064's consumer; this ticket owns
// the record it reads.
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { trade } from './columns.js';
import { deliverySignalSource, tradeActorType, tradeDeadlineKind, tradeDeadlineStatus } from './enums.js';
import { trades } from './trades.js';

export const deliverySignals = trade.table(
  'delivery_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    source: deliverySignalSource('source').notNull(),
    /** Set for BUYER_CONFIRMATION and SELLER_SELF_REPORT. */
    reportedBy: uuid('reported_by'),
    /** m2's shipment_status_events / park custody event, for the partner sources. */
    shipmentEventId: uuid('shipment_event_id'),
    evidence: jsonb('evidence'),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('delivery_signals_trade_idx').on(table.tradeId, table.reportedAt.desc().nullsFirst()),
    // A courier webhook is delivered at least once; a replay must not count as a second signal.
    uniqueIndex('delivery_signals_shipment_event')
      .on(table.tradeId, table.source, table.shipmentEventId)
      .where(sql`${table.shipmentEventId} IS NOT NULL`),
  ],
);

/**
 * One row per scheduled deadline. The jobs that fire them are idempotent and re-check state and
 * holds (design §6.2), which is why the deadline is a row rather than a timestamp on the trade:
 * an extension (DE1/DE2, BEI1) has to leave evidence of who asked and who agreed.
 */
export const tradeDeadlines = trade.table(
  'trade_deadlines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    kind: tradeDeadlineKind('kind').notNull(),
    status: tradeDeadlineStatus('status').notNull().default('PENDING'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    originalDueAt: timestamp('original_due_at', { withTimezone: true }).notNull(),
    extensionCount: integer('extension_count').notNull().default(0),
    extendedByActorType: tradeActorType('extended_by_actor_type'),
    extendedByActorId: uuid('extended_by_actor_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('trade_deadlines_extensions_non_negative', sql`${table.extensionCount} >= 0`),
    // An extension only ever moves a deadline later (DE2, BEI1).
    check('trade_deadlines_never_shortened', sql`${table.dueAt} >= ${table.originalDueAt}`),
    // Two pending deadlines of one kind would fire twice; the second insert loses here rather than
    // in whichever job happens to run first.
    uniqueIndex('trade_deadlines_one_pending')
      .on(table.tradeId, table.kind)
      .where(sql`${table.status} = 'PENDING'`),
    index('trade_deadlines_due_idx')
      .on(table.dueAt)
      .where(sql`${table.status} = 'PENDING'`),
  ],
);
