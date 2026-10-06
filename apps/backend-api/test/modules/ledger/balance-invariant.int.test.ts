// M8 D2: every journal entry's debits equal its credits, enforced by the database rather than by a
// service, so a buggy caller writing lines directly still cannot leave money unaccounted for.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import {
  countRows,
  errorMessage,
  insertAccount,
  insertJournal,
  insertLine,
  postRaw,
  sqlState,
} from './support.js';

describe.runIf(infraEnabled)('ledger balance invariant', () => {
  const t = useTestDatabase();

  // A failed assertion must not leak a connection: the pool is four wide, and a leak turns the next
  // test's failure into a timeout that hides the real one. Roll back first — releasing a client
  // whose transaction is still open or aborted hands the next test a poisoned session.
  const open: pg.PoolClient[] = [];
  afterEach(async () => {
    for (const client of open.splice(0)) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  /** A transaction the test drives statement by statement, so COMMIT can be asserted on. */
  const begin = async (): Promise<pg.PoolClient> => {
    const client = await t.app().connect();
    open.push(client);
    await client.query('BEGIN');
    return client;
  };

  /** Hands a finished connection back early, for the tests that need more than the pool is wide. */
  const done = (client: pg.PoolClient): void => {
    open.splice(open.indexOf(client), 1);
    client.release();
  };

  const accounts = async (q: pg.PoolClient | pg.Pool) => ({
    pool: await insertAccount(q, 'PLATFORM_ESCROW_POOL'),
    escrow: await insertAccount(q, 'USER_ESCROW_LIABILITY', { trade_id: randomUUID() }),
    payable: await insertAccount(q, 'USER_PAYABLE', { owner_user_id: randomUUID() }),
  });

  /** A committed, balanced two-line posting. Returns the journal entry id and its accounts. */
  const postBalanced = async (amount: bigint) => {
    const a = await accounts(t.app());
    const journal = await postRaw(t.app(), [
      { accountId: a.pool, direction: 'DEBIT', amountMinor: amount },
      { accountId: a.escrow, direction: 'CREDIT', amountMinor: amount },
    ]);
    return { journal, ...a };
  };

  it('refuses an unbalanced journal at commit, not at insert', async () => {
    const a = await accounts(t.app());
    const client = await begin();
    const journal = await insertJournal(client);
    await insertLine(client, journal, a.pool, 'DEBIT', 10_000n);
    await insertLine(client, journal, a.escrow, 'CREDIT', 9_999n); // the insert itself is accepted
    expect(await sqlState(client.query('COMMIT'))).toBe('KT010');
    expect(await countRows(t.app(), 'ledger.ledger_entries')).toBe(0);
  });

  it('names the journal entry and both sums when it refuses', async () => {
    const a = await accounts(t.app());
    const client = await begin();
    const journal = await insertJournal(client);
    await insertLine(client, journal, a.pool, 'DEBIT', 10_000n);
    await insertLine(client, journal, a.escrow, 'CREDIT', 9_999n);
    const message = await errorMessage(client.query('COMMIT'));
    expect(message).toContain(journal);
    expect(message).toContain('10000');
    expect(message).toContain('9999');
  });

  it('refuses a journal entry with no lines at all', async () => {
    const client = await begin();
    await insertJournal(client);
    expect(await sqlState(client.query('COMMIT'))).toBe('KT010');
    expect(await countRows(t.app(), 'ledger.ledger_journal_entries')).toBe(0);
  });

  it('refuses a journal that declares three lines and posts two', async () => {
    const a = await accounts(t.app());
    const client = await begin();
    const journal = await insertJournal(client, { line_count: 3 });
    await insertLine(client, journal, a.pool, 'DEBIT', 10_000n);
    await insertLine(client, journal, a.escrow, 'CREDIT', 10_000n);
    expect(await sqlState(client.query('COMMIT'))).toBe('KT010');
  });

  it('accepts a balanced multi-line journal', async () => {
    const a = await accounts(t.app());
    const client = await begin();
    const journal = await insertJournal(client, { line_count: 3 });
    await insertLine(client, journal, a.escrow, 'DEBIT', 5_000_000n);
    await insertLine(client, journal, a.payable, 'CREDIT', 4_750_000n);
    await insertLine(client, journal, a.pool, 'CREDIT', 250_000n);
    await client.query('COMMIT');
    expect(await countRows(t.app(), 'ledger.ledger_entries')).toBe(3);
  });

  it('refuses a balanced pair appended to a journal entry from an earlier transaction', async () => {
    const { journal, pool, escrow } = await postBalanced(10_000n);
    const client = await begin();
    await insertLine(client, journal, pool, 'DEBIT', 50n);
    await insertLine(client, journal, escrow, 'CREDIT', 50n);
    expect(await sqlState(client.query('COMMIT'))).toBe('KT010');
    expect(await countRows(t.app(), 'ledger.ledger_entries')).toBe(2);
  });

  it('refuses a single line appended to a committed journal entry', async () => {
    const { journal, pool } = await postBalanced(10_000n);
    expect(await sqlState(insertLine(t.app(), journal, pool, 'DEBIT', 50n))).toBe('KT010');
  });

  it('refuses lines whose account is in another currency than the posting', async () => {
    const usdPool = await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL', { currency: 'USD' });
    const usdEscrow = await insertAccount(t.app(), 'USER_ESCROW_LIABILITY', {
      currency: 'USD',
      trade_id: randomUUID(),
    });
    const client = await begin();
    const journal = await insertJournal(client); // NGN by default
    await insertLine(client, journal, usdPool, 'DEBIT', 10_000n);
    await insertLine(client, journal, usdEscrow, 'CREDIT', 10_000n);
    expect(await sqlState(client.query('COMMIT'))).toBe('KT011');
  });

  // Two transactions each holding half of one posting. A journal entry cannot commit on its own, so
  // the second transaction's line waits on the first's uncommitted journal row through the foreign
  // key; the first then fails its own balance check, and the second's line has nothing left to
  // point at. Neither half survives — the invariant fails closed rather than letting the pair
  // through on the strength of a row the other transaction could not see.
  it('refuses both halves when two transactions each post half of one journal entry', async () => {
    const a = await accounts(t.app());
    const first = await begin();
    const second = await begin();
    const journal = await insertJournal(first, { line_count: 2 });
    await insertLine(first, journal, a.pool, 'DEBIT', 10_000n);
    const blocked = sqlState(insertLine(second, journal, a.escrow, 'CREDIT', 10_000n));
    expect(await sqlState(first.query('COMMIT'))).toBe('KT010');
    expect(await blocked).toBe('23503');
    expect(await countRows(t.app(), 'ledger.ledger_entries')).toBe(0);
    expect(await countRows(t.app(), 'ledger.ledger_journal_entries')).toBe(0);
  });

  // Draining the trigger queue early with SET CONSTRAINTS ALL IMMEDIATE, then dropping the lines
  // with a savepoint rollback, is the obvious way to try to smuggle an empty journal through.
  // Postgres re-arms the trigger for events fired inside an aborted subtransaction, so it fails.
  it('refuses a posting whose lines are dropped by a savepoint rollback', async () => {
    const a = await accounts(t.app());
    const client = await begin();
    const journal = await insertJournal(client);
    await insertLine(client, journal, a.pool, 'DEBIT', 10_000n);
    await insertLine(client, journal, a.escrow, 'CREDIT', 10_000n);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SAVEPOINT drop_lines');
    await client
      .query('DELETE FROM ledger.ledger_entries WHERE journal_entry_id = $1', [journal])
      .catch(() => undefined);
    await client.query('ROLLBACK TO SAVEPOINT drop_lines');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    await insertLine(client, journal, a.pool, 'DEBIT', 1n);
    expect(await sqlState(client.query('COMMIT'))).toBe('KT010');
    expect(await countRows(t.app(), 'ledger.ledger_entries')).toBe(0);
  });

  it('keeps the trial balance at zero under twenty overlapping balanced posts', async () => {
    const a = await accounts(t.app());
    await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const client = await begin();
        const amount = BigInt(1 + i) * 1_000n;
        const journal = await insertJournal(client);
        await insertLine(client, journal, a.pool, 'DEBIT', amount);
        await insertLine(client, journal, a.escrow, 'CREDIT', amount);
        await client.query('COMMIT');
        done(client);
      }),
    );
    const { rows } = await t.app().query<{ debits: string; credits: string }>(
      `SELECT COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'DEBIT'), 0) AS debits,
              COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'CREDIT'), 0) AS credits
         FROM ledger.ledger_entries`,
    );
    expect(rows[0]?.debits).toBe(rows[0]?.credits);
    expect(await countRows(t.app(), 'ledger.ledger_entries')).toBe(40);
  });
});
