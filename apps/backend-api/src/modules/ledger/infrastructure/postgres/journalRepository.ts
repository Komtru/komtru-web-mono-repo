// Writing and reading the journal. Writing is two statements — claim the idempotency key, then the
// lines — and both run inside the caller's transaction, because the deferred balance trigger checks
// the pair at COMMIT and a journal entry on its own cannot commit at all.
import {
  cursorPageRequestSchema,
  type CursorPageRequest,
  type Kobo,
  type Paginated,
} from '@komtru/shared-types';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { ApiError } from '../../../../platform/errors.js';
import type { Tx } from '../../../../platform/events/publish.js';
import { cursorPage, decodeCursor, type CursorKey } from '../../../../platform/http/paginate.js';
import {
  currencySchema,
  DEFAULT_CURRENCY,
  type AccountRef,
  type EntryDirection,
  type LedgerAccountType,
  type PaymentProvider,
} from '../../domain/accounts.js';
import type { JournalLineInput } from '../../domain/journal.js';
import { findAccountId, resolveAccountId, type Reader } from './accountsRepository.js';
import { ledgerAccounts } from './schema/accounts.js';
import { ledgerEntries, ledgerJournalEntries } from './schema/journal.js';

export interface JournalEntryRow {
  id: string;
  idempotencyKey: string;
  description: string;
  currency: string;
  lineCount: number;
  tradeId: string | null;
  escrowActionRequestId: string | null;
  provider: PaymentProvider | null;
  providerReference: string | null;
  createdBy: string;
  postedAt: Date;
}

export interface LedgerEntryRow {
  id: string;
  journalEntryId: string;
  accountId: string;
  accountKey: string;
  accountType: LedgerAccountType;
  direction: EntryDirection;
  amountMinor: Kobo;
  createdAt: Date;
  /** `created_at` as Postgres renders it, to the microsecond. Only the cursor needs this. */
  createdAtExact: string;
}

export interface JournalEntryClaim {
  idempotencyKey: string;
  description: string;
  lineCount: number;
  currency?: string;
  tradeId?: string;
  escrowActionRequestId?: string;
  provider?: PaymentProvider;
  providerReference?: string;
  createdBy?: string;
}

const JOURNAL_COLUMNS = {
  id: ledgerJournalEntries.id,
  idempotencyKey: ledgerJournalEntries.idempotencyKey,
  description: ledgerJournalEntries.description,
  currency: ledgerJournalEntries.currency,
  lineCount: ledgerJournalEntries.lineCount,
  tradeId: ledgerJournalEntries.tradeId,
  escrowActionRequestId: ledgerJournalEntries.escrowActionRequestId,
  provider: ledgerJournalEntries.provider,
  providerReference: ledgerJournalEntries.providerReference,
  createdBy: ledgerJournalEntries.createdBy,
  postedAt: ledgerJournalEntries.postedAt,
} as const;

const ENTRY_COLUMNS = {
  id: ledgerEntries.id,
  journalEntryId: ledgerEntries.journalEntryId,
  accountId: ledgerEntries.accountId,
  accountKey: ledgerAccounts.accountKey,
  accountType: ledgerAccounts.accountType,
  direction: ledgerEntries.direction,
  amountMinor: ledgerEntries.amountMinor,
  createdAt: ledgerEntries.createdAt,
  /**
   * The timestamp at the precision Postgres stores it. `createdAt` arrives as a JavaScript Date,
   * which keeps milliseconds, and a cursor built from that rounds down past any entry written in
   * the same millisecond — a paginated money history that silently drops a line.
   */
  createdAtExact: sql<string>`${ledgerEntries.createdAt}::text`,
} as const;

/**
 * Takes the posting's idempotency key, or reports that a previous posting already owns it.
 * `ON CONFLICT DO NOTHING` rather than a SELECT first: a concurrent retry blocks on the other
 * transaction's uncommitted row and then reads it, so exactly one caller ever gets `claimed`.
 */
export async function claimJournalEntry(
  tx: Tx,
  input: JournalEntryClaim,
): Promise<{ row: JournalEntryRow; claimed: boolean }> {
  const inserted = await tx
    .insert(ledgerJournalEntries)
    .values({
      idempotencyKey: input.idempotencyKey,
      description: input.description,
      lineCount: input.lineCount,
      currency: input.currency ?? DEFAULT_CURRENCY,
      tradeId: input.tradeId,
      escrowActionRequestId: input.escrowActionRequestId,
      provider: input.provider,
      providerReference: input.providerReference,
      createdBy: input.createdBy ?? 'SYSTEM',
    })
    .onConflictDoNothing({ target: ledgerJournalEntries.idempotencyKey })
    .returning(JOURNAL_COLUMNS);
  const row = inserted[0];
  if (row) return { row, claimed: true };

  const [existing] = await tx
    .select(JOURNAL_COLUMNS)
    .from(ledgerJournalEntries)
    .where(eq(ledgerJournalEntries.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (!existing) {
    throw new Error(`ledger: journal entry ${input.idempotencyKey} neither inserted nor found`);
  }
  return { row: existing, claimed: false };
}

/**
 * Writes a posting's lines, resolving each line's account on the way, and returns them in the order
 * the caller gave them. Every line of one posting shares `now()`, so reading them back by timestamp
 * would order them by random uuid instead — and the event payload would announce a posting whose
 * lines are shuffled relative to the call that made it.
 */
export async function insertEntries(
  tx: Tx,
  journalEntryId: string,
  lines: readonly JournalLineInput[],
  currency: string = DEFAULT_CURRENCY,
): Promise<LedgerEntryRow[]> {
  const values = [];
  for (const line of lines) {
    values.push({
      journalEntryId,
      accountId: await resolveAccountId(tx, line.account, currency),
      direction: line.direction,
      amountMinor: line.amountMinor,
    });
  }
  const inserted = await tx.insert(ledgerEntries).values(values).returning({ id: ledgerEntries.id });
  if (inserted.length !== lines.length) {
    throw new Error(`ledger: expected ${lines.length} lines, wrote ${inserted.length}`);
  }
  const written = await findEntriesByJournal(tx, journalEntryId);
  const byId = new Map(written.map((row) => [row.id, row]));
  return inserted.map(({ id }) => {
    const row = byId.get(id);
    if (!row) throw new Error(`ledger: line ${id} was written but could not be read back`);
    return row;
  });
}

/** A posting's lines, oldest first, with each line's account named. */
export function findEntriesByJournal(tx: Reader, journalEntryId: string): Promise<LedgerEntryRow[]> {
  return tx
    .select(ENTRY_COLUMNS)
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(eq(ledgerEntries.journalEntryId, journalEntryId))
    .orderBy(ledgerEntries.createdAt, ledgerEntries.id);
}

/** A posting by the key it was claimed with, for a caller holding only the key. */
export async function findJournalByKey(tx: Reader, idempotencyKey: string): Promise<JournalEntryRow | null> {
  const [row] = await tx
    .select(JOURNAL_COLUMNS)
    .from(ledgerJournalEntries)
    .where(eq(ledgerJournalEntries.idempotencyKey, idempotencyKey))
    .limit(1);
  return row ?? null;
}

const toCursor = (row: LedgerEntryRow): CursorKey => ({
  createdAt: row.createdAtExact,
  id: row.id,
});

/**
 * One account's history, newest first, cursor-paginated on (created_at, id) — the sort key the
 * `ledger_entries_account_idx` index is built on, so a deep page costs the same as the first.
 */
export async function listAccountEntries(
  db: Reader,
  ref: AccountRef,
  page: CursorPageRequest,
  currency: string = DEFAULT_CURRENCY,
): Promise<Paginated<LedgerEntryRow>> {
  const { limit, cursor } = cursorPageRequestSchema.parse(page);
  const accountId = await findAccountId(db, ref, currencySchema.parse(currency));
  if (!accountId) return { items: [], nextCursor: null };

  const after = cursor ? decodeEntryCursor(cursor) : undefined;
  const afterAt = after ? sql`${after.createdAt}::timestamptz` : undefined;
  const rows = await db
    .select(ENTRY_COLUMNS)
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(
      and(
        eq(ledgerEntries.accountId, accountId),
        after && afterAt
          ? or(
              sql`${ledgerEntries.createdAt} < ${afterAt}`,
              and(sql`${ledgerEntries.createdAt} = ${afterAt}`, lt(ledgerEntries.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
    .limit(limit + 1);

  return cursorPage(rows, limit, toCursor);
}

/**
 * The cursor this module issued, read back. `decodeCursor` already proved it is a flat key; a key
 * of the right shape but the wrong fields is still the client's mistake, so it is a 422.
 */
function decodeEntryCursor(cursor: string): { createdAt: string; id: string } {
  const key = decodeCursor(cursor);
  const createdAt = typeof key.createdAt === 'string' ? key.createdAt : '';
  const id = typeof key.id === 'string' ? key.id : '';
  if (!createdAt || Number.isNaN(new Date(createdAt).getTime()) || !id) {
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'Invalid cursor',
      'Use the nextCursor from the previous page',
    );
  }
  return { createdAt, id };
}
