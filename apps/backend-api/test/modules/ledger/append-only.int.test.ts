// M8 D2: a ledger is append-only by nature — a correction is a new reversing journal entry, never an
// edit. Proven twice over: komtru_app holds no UPDATE or DELETE grant, and the trigger refuses the
// owner too. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { grantRuntimeAccess } from '../../../src/db/roles.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { countRows, insertAccount, postRaw, sqlState } from './support.js';

// Each table with a timestamp column an UPDATE could plausibly touch.
const TABLES = [
  ['ledger_accounts', 'created_at'],
  ['ledger_journal_entries', 'posted_at'],
  ['ledger_entries', 'created_at'],
] as const;

describe.runIf(infraEnabled)('ledger append-only', () => {
  const t = useTestDatabase();

  const posting = async (amount = 10_000n) => {
    const pool = await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL');
    const escrow = await insertAccount(t.app(), 'USER_ESCROW_LIABILITY', { trade_id: randomUUID() });
    const journal = await postRaw(t.app(), [
      { accountId: pool, direction: 'DEBIT', amountMinor: amount },
      { accountId: escrow, direction: 'CREDIT', amountMinor: amount },
    ]);
    return { journal, pool, escrow };
  };

  it.each(TABLES)('denies komtru_app UPDATE and DELETE on %s', async (table, column) => {
    await posting();
    expect(await sqlState(t.app().query(`UPDATE ledger.${table} SET ${column} = now()`))).toBe('42501');
    expect(await sqlState(t.app().query(`DELETE FROM ledger.${table}`))).toBe('42501');
  });

  it.each(TABLES)('blocks even the owner with KT001 on %s', async (table, column) => {
    await posting();
    expect(await sqlState(t.owner().query(`UPDATE ledger.${table} SET ${column} = now()`))).toBe('KT001');
    expect(await sqlState(t.owner().query(`DELETE FROM ledger.${table}`))).toBe('KT001');
  });

  it('cannot rewrite a posted amount', async () => {
    const { journal } = await posting();
    expect(
      await sqlState(
        t
          .app()
          .query(`UPDATE ledger.ledger_entries SET amount_minor = 1 WHERE journal_entry_id = $1`, [journal]),
      ),
    ).toBe('42501');
  });

  it('cannot re-point an account at another owner', async () => {
    const account = await insertAccount(t.app(), 'USER_PAYABLE', { owner_user_id: randomUUID() });
    expect(
      await sqlState(
        t
          .app()
          .query(`UPDATE ledger.ledger_accounts SET owner_user_id = $1 WHERE id = $2`, [
            randomUUID(),
            account,
          ]),
      ),
    ).toBe('42501');
  });

  it('records a correction as a reversing journal entry rather than an edit', async () => {
    const { journal, pool, escrow } = await posting(10_000n);
    const reversal = await postRaw(
      t.app(),
      [
        { accountId: escrow, direction: 'DEBIT', amountMinor: 10_000n },
        { accountId: pool, direction: 'CREDIT', amountMinor: 10_000n },
      ],
      { description: 'reversal', idempotency_key: `reversal:${journal}` },
    );
    expect(reversal).not.toBe(journal);
    expect(await countRows(t.app(), 'ledger.ledger_entries')).toBe(4);
  });

  it('stays append-only when grants are refreshed by a later migrate run', async () => {
    await posting();
    const client = await t.owner().connect();
    try {
      await grantRuntimeAccess(client);
    } finally {
      client.release();
    }
    expect(await sqlState(t.app().query(`UPDATE ledger.ledger_entries SET amount_minor = 1`))).toBe('42501');
  });

  it('lets komtru_app insert and read every ledger table', async () => {
    const { journal } = await posting();
    const { rows } = await t
      .app()
      .query<{ n: string }>(`SELECT count(*) AS n FROM ledger.ledger_entries WHERE journal_entry_id = $1`, [
        journal,
      ]);
    expect(Number(rows[0]?.n)).toBe(2);
  });
});
