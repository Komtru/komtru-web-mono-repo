// Balances are derived, never stored. Design §5's conflict C5 rejected the old code's single-sided
// balance rows in favour of real double-entry, and a balance column would reintroduce exactly that
// failure: a number that can disagree with the journal. A SUM over `ledger_entries` cannot drift
// from the entries it is a sum of, and `ledger_entries_account_idx` makes it an index-only walk.
//
// If this ever becomes too slow, the replacement is a rollup maintained by a trigger inside the
// same transaction as the insert, plus a reconciliation job that recomputes it from the journal and
// alerts on a difference — not a column a service writes.
import type { Kobo } from '@komtru/shared-types';
import { and, eq, sql } from 'drizzle-orm';
import {
  accountKey,
  DEFAULT_CURRENCY,
  normalBalance,
  type AccountRef,
  type LedgerAccountType,
} from '../../domain/accounts.js';
import type { Reader } from './accountsRepository.js';
import { ledgerAccounts } from './schema/accounts.js';
import { ledgerEntries } from './schema/journal.js';

export interface AccountBalance {
  /** Null when nothing has ever been posted to this account: the row does not exist yet. */
  accountId: string | null;
  accountKey: string;
  accountType: LedgerAccountType;
  currency: string;
  ownerUserId: string | null;
  tradeId: string | null;
  payoutId: string | null;
  debitsMinor: Kobo;
  creditsMinor: Kobo;
  /** In the account's own direction: positive when the account has grown (M8 §4). */
  balanceMinor: Kobo;
  entryCount: number;
}

export interface TrialBalanceRow {
  currency: string;
  debitsMinor: Kobo;
  creditsMinor: Kobo;
  /** Zero, in a ledger that is working. Anything else is an incident, not a rounding difference. */
  differenceMinor: Kobo;
}

const DEBITS = sql<string>`COALESCE(SUM(${ledgerEntries.amountMinor}) FILTER (WHERE ${ledgerEntries.direction} = 'DEBIT'), 0)`;
const CREDITS = sql<string>`COALESCE(SUM(${ledgerEntries.amountMinor}) FILTER (WHERE ${ledgerEntries.direction} = 'CREDIT'), 0)`;
const ENTRY_COUNT = sql<string>`COUNT(${ledgerEntries.id})`;

interface RawBalance {
  accountId: string;
  accountKey: string;
  accountType: LedgerAccountType;
  currency: string;
  ownerUserId: string | null;
  tradeId: string | null;
  payoutId: string | null;
  debits: string;
  credits: string;
  entryCount: string;
}

const BALANCE_COLUMNS = {
  accountId: ledgerAccounts.id,
  accountKey: ledgerAccounts.accountKey,
  accountType: ledgerAccounts.accountType,
  currency: ledgerAccounts.currency,
  ownerUserId: ledgerAccounts.ownerUserId,
  tradeId: ledgerAccounts.tradeId,
  payoutId: ledgerAccounts.payoutId,
  debits: DEBITS,
  credits: CREDITS,
  entryCount: ENTRY_COUNT,
} as const;

const toBalance = (row: RawBalance): AccountBalance => {
  const debitsMinor = BigInt(row.debits);
  const creditsMinor = BigInt(row.credits);
  return {
    accountId: row.accountId,
    accountKey: row.accountKey,
    accountType: row.accountType,
    currency: row.currency,
    ownerUserId: row.ownerUserId,
    tradeId: row.tradeId,
    payoutId: row.payoutId,
    debitsMinor,
    creditsMinor,
    balanceMinor:
      normalBalance(row.accountType) === 'DEBIT' ? debitsMinor - creditsMinor : creditsMinor - debitsMinor,
    entryCount: Number(row.entryCount),
  };
};

const scopeOf = (ref: AccountRef) => ({
  ownerUserId: ref.type === 'USER_PAYABLE' ? ref.ownerUserId : null,
  tradeId: ref.type === 'USER_ESCROW_LIABILITY' ? ref.tradeId : null,
  payoutId: ref.type === 'SETTLEMENT_CLEARING' ? ref.payoutId : null,
});

/**
 * One account's balance. An account nobody has posted to yet reads as zero rather than throwing:
 * "what do we owe on this trade" has an answer before the trade is funded, and it is nothing.
 */
export async function accountBalance(
  db: Reader,
  ref: AccountRef,
  currency: string = DEFAULT_CURRENCY,
): Promise<AccountBalance> {
  const key = accountKey(ref, currency);
  const [row] = await db
    .select(BALANCE_COLUMNS)
    .from(ledgerAccounts)
    .leftJoin(ledgerEntries, eq(ledgerEntries.accountId, ledgerAccounts.id))
    .where(eq(ledgerAccounts.accountKey, key))
    .groupBy(ledgerAccounts.id)
    .limit(1);

  if (row) return toBalance(row);
  return {
    accountId: null,
    accountKey: key,
    accountType: ref.type,
    currency,
    ...scopeOf(ref),
    debitsMinor: 0n,
    creditsMinor: 0n,
    balanceMinor: 0n,
    entryCount: 0,
  };
}

/** Every account a user owns, in one query — the "what are we holding for this person" read. */
export async function ownerBalances(
  db: Reader,
  ownerUserId: string,
  currency?: string,
): Promise<AccountBalance[]> {
  const rows = await db
    .select(BALANCE_COLUMNS)
    .from(ledgerAccounts)
    .leftJoin(ledgerEntries, eq(ledgerEntries.accountId, ledgerAccounts.id))
    .where(
      and(
        eq(ledgerAccounts.ownerUserId, ownerUserId),
        currency ? eq(ledgerAccounts.currency, currency) : undefined,
      ),
    )
    .groupBy(ledgerAccounts.id)
    .orderBy(ledgerAccounts.accountKey);
  return rows.map(toBalance);
}

/**
 * Debits against credits across the whole ledger, per currency. The difference is zero by
 * construction — the constraint triggers cannot let anything else commit — so this is the assertion
 * a reconciliation run (T-076) makes, not a number anyone has to interpret.
 */
export async function trialBalance(db: Reader): Promise<TrialBalanceRow[]> {
  const rows = await db
    .select({ currency: ledgerAccounts.currency, debits: DEBITS, credits: CREDITS })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .groupBy(ledgerAccounts.currency)
    .orderBy(ledgerAccounts.currency);
  return rows.map((row) => {
    const debitsMinor = BigInt(row.debits);
    const creditsMinor = BigInt(row.credits);
    return { currency: row.currency, debitsMinor, creditsMinor, differenceMinor: debitsMinor - creditsMinor };
  });
}
