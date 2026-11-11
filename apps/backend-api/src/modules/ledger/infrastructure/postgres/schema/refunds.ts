// M8 §5.6 / m8 plan §4 `refund_requests`: giving a buyer their money back (T-075).
//
// One row is one refund against one charge. The ledger's decision is posted BEFORE the row is written
// (its id is chosen first, so the journal key and the row agree), in the same transaction, and the row
// carries that journal: there is no refund row the ledger has not already accounted for. The provider
// call that actually returns the money comes after, from a job, and only its own verify answer moves
// the status on.
//
// Two rules live in the database rather than a service (migration 0049, hand-written part):
//   * cumulative refunds against one charge never exceed it (`ledger.guard_refund_total`, KT014). The
//     trigger locks the payment attempt row first, so two refunds racing for the same charge queue
//     behind each other and the second sees the first. A FAILED refund no longer counts: its money
//     was put back where it came from.
//   * a refund only moves forward and its money columns never change (`ledger.guard_refund`, KT015).
import { sql } from 'drizzle-orm';
import { bigint, check, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { ledger } from './columns.js';
import { paymentProvider } from './enums.js';
import { ledgerJournalEntries } from './journal.js';
import { paymentAttempts } from './payments.js';

/**
 * REQUESTED: decided and posted, not yet sent. PROCESSING: the provider has been (or is being) asked.
 * PROCESSED: the provider says the money went back. FAILED: the provider says it did not, and the
 * ledger has taken the money back into the trade's liabilities. NEEDS_REVIEW: the provider's record
 * does not match the refund, or never arrived; nothing more posts until a person decides.
 */
export const refundStatus = ledger.enum('refund_status', [
  'REQUESTED',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
  'NEEDS_REVIEW',
]);

/** FULL is the whole escrowed item (and the fee, per Q4); PARTIAL is part of the item only. */
export const refundScope = ledger.enum('refund_scope', ['FULL', 'PARTIAL']);

export const refunds = ledger.table(
  'refunds',
  {
    id: uuid('id').primaryKey(),
    /** Soft refs to trade.trades(id) and identity.users(id) (design §4.2). */
    tradeId: uuid('trade_id').notNull(),
    buyerUserId: uuid('buyer_user_id').notNull(),
    /** The ORIGINAL charge this reverses — the trade's one SUCCEEDED attempt, never client-supplied. */
    paymentAttemptId: uuid('payment_attempt_id')
      .notNull()
      .references(() => paymentAttempts.id),
    provider: paymentProvider('provider').notNull(),
    /** What the provider's Refund API is pointed at: the charge's provider reference. */
    chargeReference: text('charge_reference').notNull(),
    /** OUR reference, `refund-<id>`. Paystack accepts none, so this is our bookkeeping only. */
    reference: text('reference').notNull().unique(),
    scope: refundScope('scope').notNull(),
    /** Why: `trades.refund.requested`'s reason (DELIVERY_OVERDUE, SELLER_CANNOT_FULFIL, …). */
    reason: text('reason').notNull(),
    /** 'SYSTEM', or the staff id who decided it. */
    requestedBy: text('requested_by').notNull(),
    currency: text('currency').notNull(),
    /** Item money out of the trade's escrow liability. */
    itemAmountMinor: bigint('item_amount_minor', { mode: 'bigint' }).notNull(),
    /** Buyer protection fee handed back (Q4); zero when it is retained or recognised. */
    feeAmountMinor: bigint('fee_amount_minor', { mode: 'bigint' }).notNull(),
    /** What the buyer gets back, and what the provider is asked to refund: item plus fee. */
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    /** REFUND (back to the buyer), RECOGNISE (earned, flag false) or RETAIN (partial: left standing). */
    feeTreatment: text('fee_treatment').notNull(),
    status: refundStatus('status').notNull().default('REQUESTED'),
    /** The provider's id for the refund, once it has said. The only thing Paystack correlates on. */
    providerRefundId: text('provider_refund_id'),
    lastProviderStatus: text('last_provider_status'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    /** The last provider call that failed outright, and why. Never a provider payload. */
    lastError: text('last_error'),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    /** Words the buyer can read on FAILED or NEEDS_REVIEW. */
    failureReason: text('failure_reason'),
    decisionJournalId: uuid('decision_journal_id')
      .notNull()
      .references(() => ledgerJournalEntries.id),
    failedJournalId: uuid('failed_journal_id').references(() => ledgerJournalEntries.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('refunds_currency', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check('refunds_reference_shape', sql`${table.reference} = 'refund-' || ${table.id}::text`),
    check(
      'refunds_amounts',
      sql`${table.itemAmountMinor} >= 0 AND ${table.feeAmountMinor} >= 0 AND ${table.amountMinor} > 0
          AND ${table.amountMinor} = ${table.itemAmountMinor} + ${table.feeAmountMinor}`,
    ),
    check(
      'refunds_fee_treatment',
      sql`${table.feeTreatment} IN ('REFUND', 'RECOGNISE', 'RETAIN')
          AND (${table.feeTreatment} = 'REFUND' OR ${table.feeAmountMinor} = 0)
          AND (${table.scope} = 'FULL' OR ${table.feeTreatment} = 'RETAIN')`,
    ),
    check('refunds_reason', sql`length(${table.reason}) BETWEEN 1 AND 64`),
    check('refunds_processed', sql`(${table.status} = 'PROCESSED') = (${table.completedAt} IS NOT NULL)`),
    check(
      'refunds_failed_posted',
      sql`(${table.status} = 'FAILED') = (${table.failedJournalId} IS NOT NULL AND ${table.failedAt} IS NOT NULL)`,
    ),
    // One whole-trade refund in force at a time. A FAILED one frees the slot for a person to retry.
    uniqueIndex('refunds_one_live_full')
      .on(table.tradeId)
      .where(sql`${table.scope} = 'FULL' AND ${table.status} <> 'FAILED'`),
    uniqueIndex('refunds_provider_refund')
      .on(table.provider, table.providerRefundId)
      .where(sql`${table.providerRefundId} IS NOT NULL`),
    index('refunds_trade_idx').on(table.tradeId, table.requestedAt.desc().nullsFirst()),
    index('refunds_buyer_idx').on(
      table.buyerUserId,
      table.requestedAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('refunds_attempt_idx').on(table.paymentAttemptId),
    index('refunds_in_flight_idx')
      .on(table.status, table.updatedAt)
      .where(sql`${table.status} IN ('REQUESTED', 'PROCESSING')`),
  ],
);

export type RefundRow = typeof refunds.$inferSelect;
export type RefundStatus = RefundRow['status'];
