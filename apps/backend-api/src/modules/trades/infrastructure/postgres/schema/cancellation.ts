// Cancelling after funding (T-066, design §6.2): CR1/CR2, the buyer asks and the seller answers, and
// SC1, the seller cannot fulfil. A funded trade is never "cancelled" — M7 D3 — it is refunded, and a
// trade never refunds anything itself: an approved row here is what makes the trade publish
// `trades.refund.requested`, and the ledger's answer moves it `FUNDED -> CANCELLED_REFUNDED`.
//
// The row is the evidence of who asked, why, and who agreed. One open question per trade, and one
// approval ever: two approvals would be two refund requests for one escrow.
import { sql } from 'drizzle-orm';
import { check, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { trade } from './columns.js';
import { tradeInitiatorRole } from './enums.js';
import { trades } from './trades.js';

/** CR1's three (the buyer's) and SC1's four (the seller's). A CHECK pins each side to its own. */
export const cancellationRequestReason = trade.enum('cancellation_request_reason', [
  'CHANGED_MIND',
  'FOUND_CHEAPER',
  'ORDERED_BY_MISTAKE',
  'OUT_OF_STOCK',
  'WRONG_PRICE',
  'CANNOT_MEET_TIMELINE',
  'OTHER',
]);

/**
 * PENDING waits for the seller. APPROVED asked for the refund (a seller's SC1 is written APPROVED at
 * once). DECLINED is the seller's no (CR2's "contest"). LAPSED is a pending request the trade moved
 * past before anyone answered — it shipped, or its delivery deadline refunded the buyer anyway.
 */
export const cancellationRequestStatus = trade.enum('cancellation_request_status', [
  'PENDING',
  'APPROVED',
  'DECLINED',
  'LAPSED',
]);

export const cancellationRequests = trade.table(
  'cancellation_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    /** BUYER for CR1, SELLER for SC1. */
    requestedByRole: tradeInitiatorRole('requested_by_role').notNull(),
    requestedByUserId: uuid('requested_by_user_id').notNull(),
    reason: cancellationRequestReason('reason').notNull(),
    note: text('note'),
    status: cancellationRequestStatus('status').notNull().default('PENDING'),
    respondedByUserId: uuid('responded_by_user_id'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    responseNote: text('response_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'cancellation_request_reason_side',
      sql`(${table.requestedByRole} = 'BUYER' AND ${table.reason} IN ('CHANGED_MIND', 'FOUND_CHEAPER', 'ORDERED_BY_MISTAKE'))
          OR (${table.requestedByRole} = 'SELLER' AND ${table.reason} IN ('OUT_OF_STOCK', 'WRONG_PRICE', 'CANNOT_MEET_TIMELINE', 'OTHER'))`,
    ),
    // The seller's own cancellation needs nobody's agreement (SC1): it is never pending or declined.
    check(
      'cancellation_request_seller_approved',
      sql`${table.requestedByRole} = 'BUYER' OR ${table.status} = 'APPROVED'`,
    ),
    check(
      'cancellation_request_answered',
      sql`(${table.status} IN ('APPROVED', 'DECLINED')) = (${table.respondedAt} IS NOT NULL AND ${table.respondedByUserId} IS NOT NULL)`,
    ),
    uniqueIndex('cancellation_request_one_pending')
      .on(table.tradeId)
      .where(sql`${table.status} = 'PENDING'`),
    uniqueIndex('cancellation_request_one_approved')
      .on(table.tradeId)
      .where(sql`${table.status} = 'APPROVED'`),
    index('cancellation_request_trade_idx').on(table.tradeId, table.createdAt.desc().nullsFirst()),
  ],
);

export type CancellationRequestRow = typeof cancellationRequests.$inferSelect;
