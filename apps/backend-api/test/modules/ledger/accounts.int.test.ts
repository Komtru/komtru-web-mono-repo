// Resolving an account and reading a journal. Account identity is the thing under test: two
// codepaths asking for the same account must land on the same row, including when they ask at the
// same instant. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  accountKey,
  accountBalance,
  LEDGER_ACCOUNT_TYPES,
  claimJournalEntry,
  findEntriesByJournal,
  insertEntries,
  listAccountEntries,
  resolveAccountId,
  type AccountRef,
} from '../../../src/modules/ledger/index.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { accountRefFor, countRows, insertAccount, postRaw } from './support.js';

describe.runIf(infraEnabled)('ledger account resolution', () => {
  const t = useTestDatabase();

  const resolve = (ref: AccountRef, currency?: string) =>
    t.db().transaction((tx) => resolveAccountId(tx, ref, currency));

  it('creates an account once and returns the same id on a second call', async () => {
    const ref: AccountRef = { type: 'USER_PAYABLE', ownerUserId: randomUUID() };
    const first = await resolve(ref);
    const second = await resolve(ref);
    expect(second).toBe(first);
    expect(await countRows(t.app(), 'ledger.ledger_accounts')).toBe(1);
  });

  it('returns one id when twenty overlapping transactions resolve the same account', async () => {
    const ref: AccountRef = { type: 'USER_ESCROW_LIABILITY', tradeId: randomUUID() };
    const ids = await Promise.all(Array.from({ length: 20 }, () => resolve(ref)));
    expect(new Set(ids).size).toBe(1);
    expect(await countRows(t.app(), 'ledger.ledger_accounts')).toBe(1);
  });

  const keyOf = async (id: string) =>
    (
      await t
        .app()
        .query<{ account_key: string }>('SELECT account_key FROM ledger.ledger_accounts WHERE id = $1', [id])
    ).rows[0]?.account_key;

  // The one agreement the whole module rests on: accountKey() in TypeScript and the GENERATED
  // ALWAYS column in Postgres must spell the same account the same way, for every type and every
  // currency. If they ever diverge, a balance read finds no row and reports a confident zero.
  it.each([...LEDGER_ACCOUNT_TYPES])('names a %s exactly as accountKey() does', async (type) => {
    const ref = accountRefFor(type);
    expect(await keyOf(await resolve(ref))).toBe(accountKey(ref));
    expect(await keyOf(await resolve(ref, 'USD'))).toBe(accountKey(ref, 'USD'));
  });

  it('gives two trades two escrow accounts and one trade one', async () => {
    const a = await resolve({ type: 'USER_ESCROW_LIABILITY', tradeId: randomUUID() });
    const b = await resolve({ type: 'USER_ESCROW_LIABILITY', tradeId: randomUUID() });
    expect(a).not.toBe(b);
    expect(await countRows(t.app(), 'ledger.ledger_accounts')).toBe(2);
  });

  it('gives a second currency its own account', async () => {
    const ref: AccountRef = { type: 'PLATFORM_ESCROW_POOL' };
    expect(await resolve(ref, 'USD')).not.toBe(await resolve(ref));
  });

  it('reuses an account another codepath already created', async () => {
    const owner = randomUUID();
    const existing = await insertAccount(t.app(), 'USER_PAYABLE', { owner_user_id: owner });
    expect(await resolve({ type: 'USER_PAYABLE', ownerUserId: owner })).toBe(existing);
  });
});

describe.runIf(infraEnabled)('ledger journal claims and history', () => {
  const t = useTestDatabase();

  /** Claims the key and, when the claim is new, writes the two lines that make it commitable. */
  const claimAndFill = (key: string) =>
    t.db().transaction(async (tx) => {
      const claim = await claimJournalEntry(tx, {
        idempotencyKey: key,
        description: 'test posting',
        lineCount: 2,
        currency: 'NGN',
        createdBy: 'SYSTEM',
      });
      if (claim.claimed) {
        await insertEntries(tx, claim.row.id, [
          { account: { type: 'PLATFORM_ESCROW_POOL' }, direction: 'DEBIT', amountMinor: 10_000n },
          {
            account: { type: 'USER_ESCROW_LIABILITY', tradeId: randomUUID() },
            direction: 'CREDIT',
            amountMinor: 10_000n,
          },
        ]);
      }
      return claim;
    });

  it('claims an idempotency key once', async () => {
    const key = `charge:${randomUUID()}`;
    const first = await claimAndFill(key);
    expect(first.claimed).toBe(true);
    const second = await claimAndFill(key);
    expect(second.claimed).toBe(false);
    expect(second.row.id).toBe(first.row.id);
    expect(await countRows(t.app(), 'ledger.ledger_entries')).toBe(2);
  });

  it('reads back the lines of a journal entry', async () => {
    const key = `charge:${randomUUID()}`;
    const { row } = await claimAndFill(key);
    const lines = await t.db().transaction((tx) => findEntriesByJournal(tx, row.id));
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.direction).sort()).toEqual(['CREDIT', 'DEBIT']);
    expect(lines.every((line) => typeof line.amountMinor === 'bigint')).toBe(true);
  });

  it('pages an account history newest first and stops with a null cursor', async () => {
    const owner = randomUUID();
    const ref: AccountRef = { type: 'USER_PAYABLE', ownerUserId: owner };
    const payable = await insertAccount(t.app(), 'USER_PAYABLE', { owner_user_id: owner });
    const pool = await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL');
    for (let i = 1; i <= 5; i += 1) {
      await postRaw(t.app(), [
        { accountId: pool, direction: 'DEBIT', amountMinor: BigInt(i) * 1_000n },
        { accountId: payable, direction: 'CREDIT', amountMinor: BigInt(i) * 1_000n },
      ]);
    }

    const seen: bigint[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listAccountEntries(t.db(), ref, { limit: 2, cursor });
      seen.push(...page.items.map((item) => item.amountMinor));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
      if (pages > 5) throw new Error('pagination did not terminate');
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('returns an empty page for an account that does not exist', async () => {
    const page = await listAccountEntries(
      t.db(),
      { type: 'USER_PAYABLE', ownerUserId: randomUUID() },
      {
        limit: 20,
      },
    );
    expect(page).toEqual({ items: [], nextCursor: null });
  });

  it('returns amounts as bigint and names the account on every line', async () => {
    const owner = randomUUID();
    const payable = await insertAccount(t.app(), 'USER_PAYABLE', { owner_user_id: owner });
    const pool = await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL');
    await postRaw(t.app(), [
      { accountId: pool, direction: 'DEBIT', amountMinor: 9_007_199_254_740_993n },
      { accountId: payable, direction: 'CREDIT', amountMinor: 9_007_199_254_740_993n },
    ]);
    const page = await listAccountEntries(
      t.db(),
      { type: 'USER_PAYABLE', ownerUserId: owner },
      { limit: 20 },
    );
    expect(page.items[0]?.amountMinor).toBe(9_007_199_254_740_993n);
    expect(page.items[0]?.accountKey).toBe(accountKey({ type: 'USER_PAYABLE', ownerUserId: owner }));
    expect(page.items[0]?.accountType).toBe('USER_PAYABLE');
  });
});

// Review findings: the read path must be total over the inputs a caller can actually hand it.
describe.runIf(infraEnabled)('ledger account identity is total over its inputs', () => {
  const t = useTestDatabase();

  it('resolves the same account whatever case the uuid arrives in', async () => {
    const lower = randomUUID();
    const upper = lower.toUpperCase();
    const first = await t
      .db()
      .transaction((tx) => resolveAccountId(tx, { type: 'USER_PAYABLE', ownerUserId: lower }));
    const second = await t
      .db()
      .transaction((tx) => resolveAccountId(tx, { type: 'USER_PAYABLE', ownerUserId: upper }));
    expect(second).toBe(first);
    expect(await countRows(t.app(), 'ledger.ledger_accounts')).toBe(1);
  });

  it('names an account the same way whatever case the uuid arrives in', () => {
    const lower = randomUUID();
    expect(accountKey({ type: 'USER_PAYABLE', ownerUserId: lower.toUpperCase() })).toBe(
      accountKey({ type: 'USER_PAYABLE', ownerUserId: lower }),
    );
  });

  it('reports a balance for an upper-case uuid rather than a confident zero', async () => {
    const owner = randomUUID();
    const payable = await insertAccount(t.app(), 'USER_PAYABLE', { owner_user_id: owner });
    const pool = await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL');
    await postRaw(t.app(), [
      { accountId: pool, direction: 'DEBIT', amountMinor: 4_000n },
      { accountId: payable, direction: 'CREDIT', amountMinor: 4_000n },
    ]);
    const balance = await accountBalance(t.db(), { type: 'USER_PAYABLE', ownerUserId: owner.toUpperCase() });
    expect(balance.balanceMinor).toBe(4_000n);
  });

  it('lists history for an upper-case uuid', async () => {
    const owner = randomUUID();
    const payable = await insertAccount(t.app(), 'USER_PAYABLE', { owner_user_id: owner });
    const pool = await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL');
    await postRaw(t.app(), [
      { accountId: pool, direction: 'DEBIT', amountMinor: 4_000n },
      { accountId: payable, direction: 'CREDIT', amountMinor: 4_000n },
    ]);
    const page = await listAccountEntries(
      t.db(),
      { type: 'USER_PAYABLE', ownerUserId: owner.toUpperCase() },
      { limit: 20 },
    );
    expect(page.items).toHaveLength(1);
  });

  it('refuses a currency that is not a three-letter code rather than reporting zero', async () => {
    await expect(accountBalance(t.db(), { type: 'PLATFORM_ESCROW_POOL' }, 'ngn')).rejects.toThrow();
  });

  // Postgres keeps microseconds; a JavaScript Date keeps milliseconds. Three entries inside one
  // millisecond, at .123100, .123500 and .123900, are the case a cursor built from a Date steps
  // over: it rounds the newest down to .123000, and the two older ones are no longer "before" it.
  it('pages every entry when several land inside the same millisecond', async () => {
    const owner = randomUUID();
    const payable = await insertAccount(t.app(), 'USER_PAYABLE', { owner_user_id: owner });
    const pool = await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL');

    // One balanced posting of four lines, written as the owner so created_at can be pinned: three
    // of them land on the same account inside a single millisecond.
    const client = await t.owner().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO ledger.ledger_journal_entries (idempotency_key, description, line_count)
         VALUES ($1, 'same millisecond', 4) RETURNING id`,
        [`test:${randomUUID()}`],
      );
      const journal = rows[0]?.id;
      await client.query(
        `INSERT INTO ledger.ledger_entries (journal_entry_id, account_id, direction, amount_minor)
         VALUES ($1, $2, 'DEBIT', 3)`,
        [journal, pool],
      );
      for (const micros of ['100', '500', '900']) {
        await client.query(
          `INSERT INTO ledger.ledger_entries (journal_entry_id, account_id, direction, amount_minor, created_at)
           VALUES ($1, $2, 'CREDIT', 1, $3::timestamptz)`,
          [journal, payable, `2026-10-05T12:00:00.123${micros}+00`],
        );
      }
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 12; page += 1) {
      const result = await listAccountEntries(
        t.db(),
        { type: 'USER_PAYABLE', ownerUserId: owner },
        { limit: 1, cursor },
      );
      seen.push(...result.items.map((item) => item.id));
      cursor = result.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(3);
  });
});
