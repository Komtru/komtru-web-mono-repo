// M8 §5.2's journal. A journal entry is one posting; `ledger_entries` are its lines. Both are
// append-only (migration 0018) and the balance invariant is two deferred constraint triggers
// (migration 0017) — neither is expressible in drizzle, so both live in their own custom migration.
import { sql } from 'drizzle-orm';
import { bigint, check, index, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { ledgerAccounts } from './accounts.js';
import { ledger } from './columns.js';
import { ledgerEntryDirection, paymentProvider } from './enums.js';

export const ledgerJournalEntries = ledger.table(
  'ledger_journal_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * What this posting is a posting *of*, namespaced by the thing being replayed rather than by
     * the attempt: `charge:<providerReference>`, `trade:<id>:release`, `payout:<id>:initiated`.
     * Unique, so a retried job claims the key it already owns instead of posting a second entry.
     */
    idempotencyKey: text('idempotency_key').notNull().unique(),
    description: text('description').notNull(),
    currency: text('currency').notNull().default('NGN'),
    /**
     * How many lines this posting has. Declared by the writer and checked at commit, which closes
     * the line set: without it, a later transaction could append a balanced pair to a posting that
     * committed last week and the journal would still balance.
     */
    lineCount: smallint('line_count').notNull(),
    /** Soft refs to trade.trades(id) and trade.escrow_action_requests(id). */
    tradeId: uuid('trade_id'),
    escrowActionRequestId: uuid('escrow_action_request_id'),
    /** Set together on any posting that represents money crossing a provider boundary (m8 §4). */
    provider: paymentProvider('provider'),
    providerReference: text('provider_reference'),
    /** 'SYSTEM' or an admin user id as text. */
    createdBy: text('created_by').notNull().default('SYSTEM'),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ledger_journal_entries_trade_idx').on(table.tradeId),
    index('ledger_journal_entries_posted_idx').on(
      table.postedAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    check('ledger_journal_entries_line_count', sql`${table.lineCount} >= 2`),
    check('ledger_journal_entries_currency', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    // A namespace, then the thing: a bare uuid as a key says nothing about what a replay would be
    // replaying, and two callers would eventually choose the same one for different postings.
    check(
      'ledger_journal_entries_key_shape',
      sql`${table.idempotencyKey} ~ '^[a-z][a-z0-9_]*:[A-Za-z0-9:._-]+$'`,
    ),
    check(
      'ledger_journal_entries_provider_pair',
      sql`(${table.provider} IS NULL) = (${table.providerReference} IS NULL)`,
    ),
  ],
);

export const ledgerEntries = ledger.table(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    journalEntryId: uuid('journal_entry_id')
      .notNull()
      .references(() => ledgerJournalEntries.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id),
    direction: ledgerEntryDirection('direction').notNull(),
    /** Kobo. bigint in the database and bigint in TypeScript: a float anywhere here is a bug. */
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ledger_entries_journal_idx').on(table.journalEntryId),
    // Both the per-account balance sum and the paginated history walk this one index.
    index('ledger_entries_account_idx').on(
      table.accountId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    // Direction carries the sign; a negative amount would make a posting readable two ways.
    check('ledger_entries_amount_positive', sql`${table.amountMinor} > 0`),
  ],
);

export type LedgerJournalEntryRow = typeof ledgerJournalEntries.$inferSelect;
export type LedgerEntryTableRow = typeof ledgerEntries.$inferSelect;
