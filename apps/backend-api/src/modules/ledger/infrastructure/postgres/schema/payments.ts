// M8 §5.3 and §5.4: collecting a trade's funding (T-072).
//
// `payment_attempts` is one checkout: OUR reference, the amounts copied from the trade's fee snapshot,
// and where the provider's verify call left it. The amounts and identity columns are frozen by a
// trigger and a terminal status is final (migration 0040), so a webhook can only ever move an attempt
// forward, and a replay finds it where the first delivery left it.
//
// `payment_provider_webhooks` is the dedup log (M8 D4): every signed delivery is inserted here before
// anything else happens, unique per provider event, so a replay hits the index instead of the ledger.
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ledger } from './columns.js';
import { paymentProvider } from './enums.js';
import { ledgerJournalEntries } from './journal.js';

export const paymentAttemptStatus = ledger.enum('payment_attempt_status', [
  'INITIATED', // reference issued; the buyer has not reported paying
  'PENDING', // the buyer's Inline callback or a webhook arrived; verifying (AB3)
  'SUCCEEDED', // verified and posted
  'FAILED', // the provider says the charge failed (AB4)
  'ABANDONED', // superseded or expired with the trade; never set from Paystack's own 'abandoned'
  'NEEDS_REVIEW', // money may have moved, not as agreed; nothing posted, ops decides
]);

export const paymentAttempts = ledger.table(
  'payment_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Soft refs to trade.trades(id) and identity.users(id) (design §4.2). */
    tradeId: uuid('trade_id').notNull(),
    buyerUserId: uuid('buyer_user_id').notNull(),
    provider: paymentProvider('provider').notNull(),
    /** OUR reference, `fund-<id>`: what Paystack echoes back and what verify addresses. */
    reference: text('reference').notNull().unique(),
    /** What the provider calls the charge, once it has said. */
    providerReference: text('provider_reference'),
    currency: text('currency').notNull().default('NGN'),
    /** Copied from the trade's fee snapshot at initiation, never recomputed (design §6.5). */
    feeScheduleVersion: text('fee_schedule_version').notNull(),
    itemAmountMinor: bigint('item_amount_minor', { mode: 'bigint' }).notNull(),
    buyerProtectionFeeMinor: bigint('buyer_protection_fee_minor', { mode: 'bigint' }).notNull(),
    /** What the buyer is charged: the item plus the buyer protection fee. */
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    status: paymentAttemptStatus('status').notNull().default('INITIATED'),
    /** The verify call's raw status ('ongoing', 'abandoned', …): what AB3 versus AB4 reads. */
    lastProviderStatus: text('last_provider_status'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    verifiedAmountMinor: bigint('verified_amount_minor', { mode: 'bigint' }),
    verifiedCurrency: text('verified_currency'),
    /** The funding posting, once there is one. */
    journalEntryId: uuid('journal_entry_id').references(() => ledgerJournalEntries.id),
    failureReason: text('failure_reason'),
    initiatedAt: timestamp('initiated_at', { withTimezone: true }).notNull().defaultNow(),
    pendingAt: timestamp('pending_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('payment_attempts_currency', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      'payment_attempts_amounts',
      sql`${table.itemAmountMinor} > 0 AND ${table.buyerProtectionFeeMinor} >= 0
          AND ${table.amountMinor} = ${table.itemAmountMinor} + ${table.buyerProtectionFeeMinor}`,
    ),
    check('payment_attempts_reference_shape', sql`${table.reference} = 'fund-' || ${table.id}::text`),
    // A success is a posting: one without the other is money the ledger does not know about, or a
    // posting no attempt answers for.
    check(
      'payment_attempts_succeeded_posted',
      sql`(${table.status} = 'SUCCEEDED') = (${table.journalEntryId} IS NOT NULL AND ${table.confirmedAt} IS NOT NULL)`,
    ),
    check(
      'payment_attempts_closed',
      sql`(${table.status} IN ('FAILED', 'ABANDONED', 'NEEDS_REVIEW')) = (${table.closedAt} IS NOT NULL)`,
    ),
    index('payment_attempts_trade_idx').on(table.tradeId, table.initiatedAt.desc().nullsFirst()),
    uniqueIndex('payment_attempts_provider_ref')
      .on(table.provider, table.providerReference)
      .where(sql`${table.providerReference} IS NOT NULL`),
    // One live checkout per trade, and one success: a second success is a double charge.
    uniqueIndex('payment_attempts_one_open')
      .on(table.tradeId)
      .where(sql`${table.status} IN ('INITIATED', 'PENDING')`),
    uniqueIndex('payment_attempts_one_success')
      .on(table.tradeId)
      .where(sql`${table.status} = 'SUCCEEDED'`),
  ],
);

export type PaymentAttemptRow = typeof paymentAttempts.$inferSelect;

export const paymentProviderWebhooks = ledger.table(
  'payment_provider_webhooks',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    provider: paymentProvider('provider').notNull(),
    /** `paystackEventId()`: the event type and the provider's id for the object it is about. */
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type').notNull(),
    /** The parsed body. The signature was checked on the raw bytes before this row existed. */
    payload: jsonb('payload').notNull(),
    /** Always true today: an unsigned delivery is refused with 401, not stored (M8 §11). */
    signatureValid: boolean('signature_valid').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    /** Why processing stopped without acting: unreadable, unknown reference, and so on. */
    processingError: text('processing_error'),
    /** Replays of this event that hit the dedup index. */
    duplicateCount: integer('duplicate_count').notNull().default(0),
  },
  (table) => [
    uniqueIndex('payment_provider_webhooks_dedup').on(table.provider, table.providerEventId),
    index('payment_provider_webhooks_unprocessed_idx')
      .on(table.receivedAt)
      .where(sql`${table.processedAt} IS NULL`),
    check('payment_provider_webhooks_signed', sql`${table.signatureValid}`),
  ],
);

export type PaymentProviderWebhookRow = typeof paymentProviderWebhooks.$inferSelect;
