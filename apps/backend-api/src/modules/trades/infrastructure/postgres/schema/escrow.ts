// A trade never holds money (M7 §0 rule 2). It writes an escrow action *request* and publishes an
// event; the ledger (M8) answers with payment.escrow_funded / _released / _refunded. Holds freeze
// auto-transitions and release without hiding where a trade is (design §6.2).
import { sql } from 'drizzle-orm';
import { bigint, check, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { trade } from './columns.js';
import { escrowActionStatus, escrowActionType, tradeActorType, tradeHoldSource } from './enums.js';
import { trades } from './trades.js';

export const escrowActionRequests = trade.table(
  'escrow_action_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    action: escrowActionType('action').notNull(),
    /** From the trade's fee snapshot, never recomputed from the live fee file (§6.5). */
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    status: escrowActionStatus('status').notNull().default('REQUESTED'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    /** The ledger's own reference once the entry has landed. */
    ledgerRef: text('ledger_ref'),
  },
  (table) => [
    check('escrow_requests_amount_positive', sql`${table.amountMinor} > 0`),
    // Two open release requests for one trade is a double payout waiting for a retry to find it.
    uniqueIndex('escrow_requests_one_open')
      .on(table.tradeId, table.action)
      .where(sql`${table.status} IN ('REQUESTED', 'ACKNOWLEDGED')`),
    index('escrow_requests_pending_idx')
      .on(table.requestedAt)
      .where(sql`${table.status} IN ('REQUESTED', 'ACKNOWLEDGED')`),
  ],
);

export const tradeHolds = trade.table(
  'trade_holds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    source: tradeHoldSource('source').notNull(),
    reason: text('reason').notNull(),
    placedByActorType: tradeActorType('placed_by_actor_type').notNull(),
    placedByActorId: uuid('placed_by_actor_id'),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releasedByActorId: uuid('released_by_actor_id'),
    releaseReason: text('release_reason'),
  },
  (table) => [
    uniqueIndex('trade_holds_one_active')
      .on(table.tradeId, table.source)
      .where(sql`${table.releasedAt} IS NULL`),
    index('trade_holds_active_idx')
      .on(table.tradeId)
      .where(sql`${table.releasedAt} IS NULL`),
  ],
);
