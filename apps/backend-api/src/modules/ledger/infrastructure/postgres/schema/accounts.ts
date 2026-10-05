// M8 §5.2's chart of accounts. An account is a type plus a currency plus at most one scope, and
// that triple is its identity: `account_key` is GENERATED ALWAYS, so no caller can write it and no
// two codepaths can invent different accounts for the same thing. Resolving an account is therefore
// one INSERT ... ON CONFLICT (account_key) rather than a check-then-insert.
import { sql } from 'drizzle-orm';
import { check, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { ledger } from './columns.js';
import { ledgerAccountType } from './enums.js';

// The enum-to-text cast is not immutable, so Postgres refuses it in a generation expression; a CASE
// over the enum's own equality operator is immutable and produces the same string.
const ACCOUNT_KEY = sql`"currency" || ':' || (CASE "account_type"
    WHEN 'PLATFORM_ESCROW_POOL' THEN 'PLATFORM_ESCROW_POOL'
    WHEN 'USER_ESCROW_LIABILITY' THEN 'USER_ESCROW_LIABILITY'
    WHEN 'USER_PAYABLE' THEN 'USER_PAYABLE'
    WHEN 'PLATFORM_FEE_REVENUE' THEN 'PLATFORM_FEE_REVENUE'
    WHEN 'BUYER_PROTECTION_FEE_REVENUE' THEN 'BUYER_PROTECTION_FEE_REVENUE'
    WHEN 'SETTLEMENT_CLEARING' THEN 'SETTLEMENT_CLEARING'
  END) || ':' || COALESCE("owner_user_id"::text, "trade_id"::text, "payout_id"::text, '-')`;

export const ledgerAccounts = ledger.table(
  'ledger_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountType: ledgerAccountType('account_type').notNull(),
    currency: text('currency').notNull().default('NGN'),
    /** Soft ref to identity.users(id): the user a payable belongs to. */
    ownerUserId: uuid('owner_user_id'),
    /** Soft ref to trade.trades(id): the trade an escrow liability belongs to. */
    tradeId: uuid('trade_id'),
    /** Soft ref to the payout a settlement clearing account belongs to (T-073). */
    payoutId: uuid('payout_id'),
    /** `NGN:USER_PAYABLE:<uuid>`. Computed by Postgres from the row; never writable. */
    accountKey: text('account_key').generatedAlwaysAs(ACCOUNT_KEY).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ledger_accounts_key_unique').on(table.accountKey),
    index('ledger_accounts_owner_idx').on(table.ownerUserId),
    check('ledger_accounts_currency', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    // Which scope an account carries is a property of its type, not of the caller's intent: a
    // payable without an owner, or an escrow liability that also names a user, would be two
    // different accounts for the same money depending on who wrote it.
    check(
      'ledger_accounts_scope',
      sql`CASE ${table.accountType}
            WHEN 'USER_ESCROW_LIABILITY' THEN ${table.tradeId} IS NOT NULL AND ${table.ownerUserId} IS NULL AND ${table.payoutId} IS NULL
            WHEN 'USER_PAYABLE' THEN ${table.ownerUserId} IS NOT NULL AND ${table.tradeId} IS NULL AND ${table.payoutId} IS NULL
            WHEN 'SETTLEMENT_CLEARING' THEN ${table.payoutId} IS NOT NULL AND ${table.ownerUserId} IS NULL AND ${table.tradeId} IS NULL
            ELSE ${table.ownerUserId} IS NULL AND ${table.tradeId} IS NULL AND ${table.payoutId} IS NULL
          END`,
    ),
  ],
);

export type LedgerAccountRow = typeof ledgerAccounts.$inferSelect;
