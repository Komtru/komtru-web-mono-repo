// M8 §5.5 and the m8 plan §4: getting a seller paid out (T-073).
//
// `payout_accounts` is where the money may go. The full account number is held encrypted, because a
// transfer recipient is created from it; it is never returned to a client, never logged, and never
// a lookup key — `account_number_hash` is, under the platform pepper. The name on the account is the
// one the provider resolved, never one a user typed (m8 §7).
//
// `payout_preferences` is how a user wants to be paid. It holds the mode only: the destination of an
// automatic payout is the user's default account, so there is one "default" in the schema, not two
// that can disagree.
//
// `payouts` is one withdrawal: what left the payable, the fee frozen from the fee file at the moment
// it was asked for, what the bank is sent, and the three journal entries that can answer for it. Its
// identity and amounts are frozen by a trigger and its status only moves forward (migration 0048).
//
// `payout_holds` is the risk gate (M13 §1: "M13 only requests a hold; M8 enforces it before
// disbursing"). T-101 does not exist yet, so the ledger owns the table it will write.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ledger } from './columns.js';
import { paymentProvider } from './enums.js';
import { ledgerJournalEntries } from './journal.js';

/** `bytea`, as a Buffer (drizzle 0.45 has no native one; trust declares the same one-liner). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const PAYOUT_ACCOUNT_STATUSES = ['PENDING_VERIFICATION', 'VERIFIED', 'FAILED', 'DISABLED'] as const;
export const PAYOUT_MODES = [
  'MANUAL',
  'AUTO_IMMEDIATE',
  'AUTO_DAILY',
  'AUTO_WEEKLY',
  'AUTO_MONTHLY',
] as const;
export const PAYOUT_TRIGGERS = ['MANUAL', 'AUTO_IMMEDIATE', 'AUTO_SWEEP'] as const;
export const PAYOUT_STATUSES = [
  'REQUESTED', // posted to clearing; the transfer has not been asked for yet
  'PROCESSING', // the transfer was asked for (or is being); the provider has not finished
  'SUCCEEDED', // the provider confirmed it; the cash left the pool
  'FAILED', // the provider refused or failed it; the whole debit is back in the payable
  'REVERSED', // the provider reversed it; the whole debit is back in the payable
  'NEEDS_REVIEW', // the provider's answer does not match what we sent; nothing posted, ops decides
] as const;
export const PAYOUT_HOLD_TYPES = ['PAYOUT_HOLD', 'FULL_FREEZE'] as const;

export type PayoutAccountStatus = (typeof PAYOUT_ACCOUNT_STATUSES)[number];
export type PayoutMode = (typeof PAYOUT_MODES)[number];
export type PayoutTrigger = (typeof PAYOUT_TRIGGERS)[number];
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
export type PayoutHoldType = (typeof PAYOUT_HOLD_TYPES)[number];

export const payoutAccountStatus = ledger.enum('payout_account_status', PAYOUT_ACCOUNT_STATUSES);
export const payoutMode = ledger.enum('payout_mode', PAYOUT_MODES);
export const payoutTrigger = ledger.enum('payout_trigger', PAYOUT_TRIGGERS);
export const payoutStatus = ledger.enum('payout_status', PAYOUT_STATUSES);
export const payoutHoldType = ledger.enum('payout_hold_type', PAYOUT_HOLD_TYPES);

export const payoutAccounts = ledger.table(
  'payout_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Soft ref to identity.users(id). Users only: no company, hub or platform owns one (C23). */
    userId: uuid('user_id').notNull(),
    provider: paymentProvider('provider').notNull(),
    bankCode: text('bank_code').notNull(),
    /** From the cached bank list when the account was added; display only. */
    bankName: text('bank_name'),
    /** AES-256-GCM (`platform/crypto/encryption.ts`). Needed for the recipient call, nothing else. */
    accountNumberEnc: text('account_number_enc').notNull(),
    /** `******5567`: the only form of the number any client ever sees. */
    accountNumberMasked: text('account_number_masked').notNull(),
    /** HMAC under the platform pepper, domain `ledger:payout-account`: the de-duplication key. */
    accountNumberHash: bytea('account_number_hash').notNull(),
    /** The holder's name as the provider resolved it. Never user-typed (m8 §7). */
    accountName: text('account_name'),
    /** The provider's transfer recipient (`RCP_…`), created once the name resolved. */
    providerRecipientId: text('provider_recipient_id'),
    /** Soft ref to trust.bank_account_name_matches(id): T-051's verdict, when there is one. */
    nameMatchRef: uuid('name_match_ref'),
    nameMatchResult: text('name_match_result'),
    status: payoutAccountStatus('status').notNull().default('PENDING_VERIFICATION'),
    isDefault: boolean('is_default').notNull().default(false),
    /** Why verification failed, in words a seller can act on. Never a provider payload. */
    failureReason: text('failure_reason'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payout_accounts_user_idx').on(table.userId, table.createdAt.desc().nullsFirst()),
    // One live record of one bank account per user. A FAILED or DISABLED one may be added again.
    uniqueIndex('payout_accounts_one_live')
      .on(table.userId, table.bankCode, table.accountNumberHash)
      .where(sql`${table.status} IN ('PENDING_VERIFICATION', 'VERIFIED')`),
    // One default per owner (T-073); only a verified account can be it (the CHECK below).
    uniqueIndex('payout_accounts_one_default')
      .on(table.userId)
      .where(sql`${table.isDefault}`),
    check(
      'payout_accounts_verified',
      sql`(${table.status} = 'VERIFIED') = (${table.verifiedAt} IS NOT NULL AND ${table.accountName} IS NOT NULL AND ${table.providerRecipientId} IS NOT NULL)
          OR (${table.status} = 'DISABLED' AND ${table.verifiedAt} IS NOT NULL)`,
    ),
    check('payout_accounts_default_verified', sql`NOT ${table.isDefault} OR ${table.status} = 'VERIFIED'`),
    check(
      'payout_accounts_disabled',
      sql`(${table.status} = 'DISABLED') = (${table.disabledAt} IS NOT NULL)`,
    ),
    check('payout_accounts_masked', sql`${table.accountNumberMasked} ~ '^\\*+[0-9]{4}$'`),
  ],
);

export type PayoutAccountRow = typeof payoutAccounts.$inferSelect;

export const payoutPreferences = ledger.table('payout_preferences', {
  /** Soft ref to identity.users(id); one row per user, absent means MANUAL. */
  userId: uuid('user_id').primaryKey(),
  mode: payoutMode('mode').notNull().default('MANUAL'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PayoutPreferenceRow = typeof payoutPreferences.$inferSelect;

export const payouts = ledger.table(
  'payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Soft ref to identity.users(id): whose payable this left. */
    userId: uuid('user_id').notNull(),
    payoutAccountId: uuid('payout_account_id')
      .notNull()
      .references(() => payoutAccounts.id),
    provider: paymentProvider('provider').notNull(),
    trigger: payoutTrigger('trigger').notNull(),
    status: payoutStatus('status').notNull().default('REQUESTED'),
    currency: text('currency').notNull().default('NGN'),
    /** What left the payable. */
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    /** `payout_fee` from the fee file, frozen when the payout was asked for (design §6.5). */
    feeMinor: bigint('fee_minor', { mode: 'bigint' }).notNull(),
    feeScheduleVersion: text('fee_schedule_version').notNull(),
    /** What the bank is sent: the amount less the fee. */
    transferAmountMinor: bigint('transfer_amount_minor', { mode: 'bigint' }).notNull(),
    /** OUR reference, `payout-<id>`: what the provider echoes and what verify addresses. */
    reference: text('reference').notNull().unique(),
    /** The provider's transfer code, once it has said. */
    providerTransferId: text('provider_transfer_id'),
    /** The provider's last raw status: 'pending', 'success', 'failed', 'reversed', … */
    lastProviderStatus: text('last_provider_status'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    /** AUTO_IMMEDIATE: the release journal whose credit this pays out. One payout per credit. */
    sourceJournalEntryId: uuid('source_journal_entry_id').references(() => ledgerJournalEntries.id),
    /** AUTO_IMMEDIATE: the trade that credit came from, for PR1's "From trade". */
    sourceTradeId: uuid('source_trade_id'),
    /** AUTO_SWEEP: `<mode>:<user>:<yyyy-mm-dd>`, so a sweep runs once per user per day. */
    sweepKey: text('sweep_key').unique(),
    initiatedJournalId: uuid('initiated_journal_id')
      .notNull()
      .references(() => ledgerJournalEntries.id),
    settledJournalId: uuid('settled_journal_id').references(() => ledgerJournalEntries.id),
    reversedJournalId: uuid('reversed_journal_id').references(() => ledgerJournalEntries.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payouts_user_idx').on(
      table.userId,
      table.requestedAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('payouts_in_flight_idx')
      .on(table.status, table.updatedAt)
      .where(sql`${table.status} IN ('REQUESTED', 'PROCESSING')`),
    // "Which payouts went to this account" (removing an account, ops) and "which payout paid this
    // trade" (PR1, T-076) are both lookups by a reference column; without these they are table scans.
    index('payouts_account_idx').on(table.payoutAccountId),
    index('payouts_source_trade_idx')
      .on(table.sourceTradeId)
      .where(sql`${table.sourceTradeId} IS NOT NULL`),
    uniqueIndex('payouts_one_per_source')
      .on(table.sourceJournalEntryId)
      .where(sql`${table.sourceJournalEntryId} IS NOT NULL`),
    uniqueIndex('payouts_provider_transfer')
      .on(table.provider, table.providerTransferId)
      .where(sql`${table.providerTransferId} IS NOT NULL`),
    check('payouts_currency', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      'payouts_amounts',
      sql`${table.feeMinor} >= 0 AND ${table.transferAmountMinor} > 0
          AND ${table.amountMinor} = ${table.transferAmountMinor} + ${table.feeMinor}`,
    ),
    check('payouts_reference_shape', sql`${table.reference} = 'payout-' || ${table.id}::text`),
    check(
      'payouts_trigger_source',
      sql`(${table.trigger} = 'AUTO_IMMEDIATE') = (${table.sourceJournalEntryId} IS NOT NULL)
          AND (${table.trigger} = 'AUTO_SWEEP') = (${table.sweepKey} IS NOT NULL)`,
    ),
    // Each outcome carries the posting that answers for it.
    check(
      'payouts_succeeded_posted',
      sql`${table.status} <> 'SUCCEEDED' OR (${table.settledJournalId} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`,
    ),
    check(
      'payouts_reversed_posted',
      sql`(${table.status} IN ('FAILED', 'REVERSED')) = (${table.reversedJournalId} IS NOT NULL AND ${table.failedAt} IS NOT NULL)`,
    ),
  ],
);

export type PayoutRow = typeof payouts.$inferSelect;

export const payoutHolds = ledger.table(
  'payout_holds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Soft ref to identity.users(id). */
    userId: uuid('user_id').notNull(),
    holdType: payoutHoldType('hold_type').notNull(),
    /** Who asked: `RISK_RULE:<rule>`, `REVIEWER:<staff id>`, … */
    source: text('source').notNull(),
    reason: text('reason').notNull(),
    /** A rule-applied hold is time-boxed (M13 §1); a reviewer's may be open-ended. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releasedBy: text('released_by'),
  },
  (table) => [
    index('payout_holds_active_idx')
      .on(table.userId)
      .where(sql`${table.releasedAt} IS NULL`),
    check('payout_holds_released', sql`(${table.releasedAt} IS NULL) = (${table.releasedBy} IS NULL)`),
  ],
);

export type PayoutHoldRow = typeof payoutHolds.$inferSelect;
