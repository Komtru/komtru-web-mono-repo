// Shared helpers for the ledger schema's integration tests.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { AccountRef, LedgerAccountType } from '../../../src/modules/ledger/index.js';

/**
 * A ref for any account type in the chart, with a fresh scope where the type carries one. The
 * switch has no `default`, so a type added to the chart without a case here fails to compile —
 * which is what keeps the tests that iterate LEDGER_ACCOUNT_TYPES honest instead of silently
 * skipping the new one.
 */
export const accountRefFor = (type: LedgerAccountType): AccountRef => {
  switch (type) {
    case 'USER_ESCROW_LIABILITY':
    case 'BUYER_PROTECTION_FEE_LIABILITY':
      return { type, tradeId: randomUUID() };
    case 'USER_PAYABLE':
      return { type, ownerUserId: randomUUID() };
    case 'SETTLEMENT_CLEARING':
      return { type, payoutId: randomUUID() };
    case 'PLATFORM_ESCROW_POOL':
    case 'PLATFORM_FEE_REVENUE':
    case 'BUYER_PROTECTION_FEE_REVENUE':
      return { type };
  }
};

type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

/** The SQLSTATE of a rejected query, so a test asserts which rule fired rather than that one did. */
export const sqlState = async (query: Promise<unknown>): Promise<string> => {
  try {
    await query;
  } catch (error) {
    return (error as pg.DatabaseError).code ?? 'no code';
  }
  return 'no error';
};

/** The constraint a rejected query violated, for the checks that share a SQLSTATE. */
export const constraintName = async (query: Promise<unknown>): Promise<string> => {
  try {
    await query;
  } catch (error) {
    return (error as pg.DatabaseError).constraint ?? 'no constraint';
  }
  return 'no error';
};

/** The message of a rejected query, for the rules a trigger raises rather than a constraint. */
export const errorMessage = async (query: Promise<unknown>): Promise<string> => {
  try {
    await query;
  } catch (error) {
    return (error as Error).message;
  }
  return 'no error';
};

export const enumLabels = async (owner: pg.Pool, name: string): Promise<string[]> => {
  const { rows } = await owner.query<{ label: string }>(
    `SELECT e.enumlabel AS label
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'ledger' AND t.typname = $1
      ORDER BY e.enumsortorder`,
    [name],
  );
  return rows.map((row) => row.label);
};

export const countRows = async (q: Queryable, table: string): Promise<number> => {
  const { rows } = await q.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
  return Number(rows[0]?.n ?? 0);
};

/** Inserts a ledger account and returns its id. Columns are whatever the caller names. */
export const insertAccount = async (
  q: Queryable,
  accountType: string,
  scope: Record<string, unknown> = {},
): Promise<string> => {
  const values: Record<string, unknown> = { account_type: accountType, ...scope };
  const columns = Object.keys(values);
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO ledger.ledger_accounts (${columns.join(', ')})
     VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    Object.values(values),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('insertAccount(): no row returned');
  return id;
};

export const insertJournal = async (
  q: Queryable,
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const values: Record<string, unknown> = {
    idempotency_key: `test:${randomUUID()}`,
    description: 'test posting',
    line_count: 2,
    ...overrides,
  };
  const columns = Object.keys(values);
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO ledger.ledger_journal_entries (${columns.join(', ')})
     VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    Object.values(values),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('insertJournal(): no row returned');
  return id;
};

export const insertLine = (
  q: Queryable,
  journalEntryId: string,
  accountId: string,
  direction: 'DEBIT' | 'CREDIT',
  amountMinor: bigint,
): Promise<unknown> =>
  q.query(
    `INSERT INTO ledger.ledger_entries (journal_entry_id, account_id, direction, amount_minor)
     VALUES ($1, $2, $3, $4)`,
    [journalEntryId, accountId, direction, amountMinor.toString()],
  );

export interface RawLine {
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: bigint;
}

/**
 * A whole posting written in one transaction, the way the database requires: a journal entry alone
 * cannot commit, because the deferred balance trigger sees it with no lines.
 */
export const postRaw = async (
  pool: pg.Pool,
  lines: RawLine[],
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const journal = await insertJournal(client, { line_count: lines.length, ...overrides });
    for (const line of lines) {
      await insertLine(client, journal, line.accountId, line.direction, line.amountMinor);
    }
    await client.query('COMMIT');
    return journal;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
