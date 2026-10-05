// Balances per account and per owner, derived from the journal. The thing under test is that they
// cannot disagree with the entries: a posting written straight to the tables, with postJournal out
// of the way, moves them exactly as a posting through the service does.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  LEDGER_ACCOUNT_TYPES,
  normalBalance,
  ownerBalances,
  postJournal,
  trialBalance,
  type AccountRef,
  type LedgerAccountType,
} from '../../../src/modules/ledger/index.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { insertAccount, postRaw } from './support.js';

describe.runIf(infraEnabled)('ledger balances', () => {
  const t = useTestDatabase();

  const seller = randomUUID();
  const trade = randomUUID();
  const payout = randomUUID();

  const POOL: AccountRef = { type: 'PLATFORM_ESCROW_POOL' };
  const ESCROW: AccountRef = { type: 'USER_ESCROW_LIABILITY', tradeId: trade };
  const PAYABLE: AccountRef = { type: 'USER_PAYABLE', ownerUserId: seller };

  /** A scope-carrying ref for any account type, so every type can be exercised the same way. */
  const refFor = (type: LedgerAccountType): AccountRef => {
    switch (type) {
      case 'USER_ESCROW_LIABILITY':
        return { type, tradeId: randomUUID() };
      case 'USER_PAYABLE':
        return { type, ownerUserId: randomUUID() };
      case 'SETTLEMENT_CLEARING':
        return { type, payoutId: randomUUID() };
      default:
        return { type };
    }
  };

  const post = (input: Parameters<typeof postJournal>[1]) =>
    t.db().transaction((tx) => postJournal(tx, input));

  it('reports zero for an account that has never been posted to', async () => {
    const balance = await accountBalance(t.db(), PAYABLE);
    expect(balance).toMatchObject({
      accountId: null,
      accountKey: `NGN:USER_PAYABLE:${seller}`,
      accountType: 'USER_PAYABLE',
      ownerUserId: seller,
      debitsMinor: 0n,
      creditsMinor: 0n,
      balanceMinor: 0n,
      entryCount: 0,
    });
  });

  it('reports an asset balance as debits minus credits', async () => {
    await post({
      idempotencyKey: `charge:${randomUUID()}`,
      description: 'funded',
      lines: [
        { account: POOL, direction: 'DEBIT', amountMinor: 5_000_000n },
        { account: ESCROW, direction: 'CREDIT', amountMinor: 5_000_000n },
      ],
    });
    await post({
      idempotencyKey: `payout:${payout}:completed`,
      description: 'paid out',
      lines: [
        { account: ESCROW, direction: 'DEBIT', amountMinor: 1_000_000n },
        { account: POOL, direction: 'CREDIT', amountMinor: 1_000_000n },
      ],
    });
    const pool = await accountBalance(t.db(), POOL);
    expect(pool.debitsMinor).toBe(5_000_000n);
    expect(pool.creditsMinor).toBe(1_000_000n);
    expect(pool.balanceMinor).toBe(4_000_000n);
    expect(pool.entryCount).toBe(2);
  });

  it('reports a liability balance as credits minus debits', async () => {
    await post({
      idempotencyKey: `trade:${trade}:release`,
      description: 'released',
      lines: [
        { account: ESCROW, direction: 'DEBIT', amountMinor: 5_000_000n },
        { account: PAYABLE, direction: 'CREDIT', amountMinor: 4_750_000n },
        { account: { type: 'PLATFORM_FEE_REVENUE' }, direction: 'CREDIT', amountMinor: 250_000n },
      ],
    });
    expect((await accountBalance(t.db(), PAYABLE)).balanceMinor).toBe(4_750_000n);
    expect((await accountBalance(t.db(), ESCROW)).balanceMinor).toBe(-5_000_000n);
  });

  it.each(LEDGER_ACCOUNT_TYPES)('signs %s in its own normal direction', async (type) => {
    const ref = refFor(type);
    const other: AccountRef = { type: 'PLATFORM_ESCROW_POOL' };
    if (type === 'PLATFORM_ESCROW_POOL') return;
    await post({
      idempotencyKey: `prop:${type.toLowerCase()}:grow`,
      description: `grow ${type}`,
      lines:
        normalBalance(type) === 'CREDIT'
          ? [
              { account: other, direction: 'DEBIT', amountMinor: 1_000n },
              { account: ref, direction: 'CREDIT', amountMinor: 1_000n },
            ]
          : [
              { account: ref, direction: 'DEBIT', amountMinor: 1_000n },
              { account: other, direction: 'CREDIT', amountMinor: 1_000n },
            ],
    });
    expect((await accountBalance(t.db(), ref)).balanceMinor).toBe(1_000n);
  });

  it('lists every account a user owns', async () => {
    const payableNgn = await insertAccount(t.app(), 'USER_PAYABLE', { owner_user_id: seller });
    const payableUsd = await insertAccount(t.app(), 'USER_PAYABLE', {
      owner_user_id: seller,
      currency: 'USD',
    });
    const pool = await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL');
    await postRaw(t.app(), [
      { accountId: pool, direction: 'DEBIT', amountMinor: 3_000n },
      { accountId: payableNgn, direction: 'CREDIT', amountMinor: 3_000n },
    ]);

    const all = await ownerBalances(t.db(), seller);
    expect(all.map((balance) => balance.accountId).sort()).toEqual([payableNgn, payableUsd].sort());
    expect(all.find((balance) => balance.currency === 'NGN')?.balanceMinor).toBe(3_000n);
    expect(all.find((balance) => balance.currency === 'USD')?.balanceMinor).toBe(0n);

    const ngnOnly = await ownerBalances(t.db(), seller, 'NGN');
    expect(ngnOnly).toHaveLength(1);
  });

  it('returns nothing for a user who owns no account', async () => {
    expect(await ownerBalances(t.db(), randomUUID())).toEqual([]);
  });

  // A balance that a hand-written entry can move away from the journal is the failure C5 rejected.
  // This writes straight to the tables and asserts the balance follows the entries, not a column.
  it('follows an entry written without going through postJournal', async () => {
    const pool = await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL');
    const escrow = await insertAccount(t.app(), 'USER_ESCROW_LIABILITY', { trade_id: trade });
    await postRaw(t.app(), [
      { accountId: pool, direction: 'DEBIT', amountMinor: 7_777n },
      { accountId: escrow, direction: 'CREDIT', amountMinor: 7_777n },
    ]);
    expect((await accountBalance(t.db(), POOL)).balanceMinor).toBe(7_777n);
    expect((await accountBalance(t.db(), ESCROW)).balanceMinor).toBe(7_777n);
  });

  it('keeps the trial balance at zero and reports one row per currency', async () => {
    const poolNgn = await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL');
    const escrowNgn = await insertAccount(t.app(), 'USER_ESCROW_LIABILITY', { trade_id: trade });
    const poolUsd = await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL', { currency: 'USD' });
    const escrowUsd = await insertAccount(t.app(), 'USER_ESCROW_LIABILITY', {
      currency: 'USD',
      trade_id: randomUUID(),
    });
    await postRaw(t.app(), [
      { accountId: poolNgn, direction: 'DEBIT', amountMinor: 1_000n },
      { accountId: escrowNgn, direction: 'CREDIT', amountMinor: 1_000n },
    ]);
    await postRaw(
      t.app(),
      [
        { accountId: poolUsd, direction: 'DEBIT', amountMinor: 2_000n },
        { accountId: escrowUsd, direction: 'CREDIT', amountMinor: 2_000n },
      ],
      { currency: 'USD' },
    );

    const rows = await trialBalance(t.db());
    expect(rows.map((row) => row.currency)).toEqual(['NGN', 'USD']);
    for (const row of rows) expect(row.differenceMinor).toBe(0n);
    expect(rows[1]?.debitsMinor).toBe(2_000n);
  });

  it('returns bigint amounts, never number', async () => {
    const pool = await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL');
    const escrow = await insertAccount(t.app(), 'USER_ESCROW_LIABILITY', { trade_id: trade });
    await postRaw(t.app(), [
      { accountId: pool, direction: 'DEBIT', amountMinor: 9_007_199_254_740_993n },
      { accountId: escrow, direction: 'CREDIT', amountMinor: 9_007_199_254_740_993n },
    ]);
    const balance = await accountBalance(t.db(), POOL);
    expect(typeof balance.balanceMinor).toBe('bigint');
    expect(balance.balanceMinor).toBe(9_007_199_254_740_993n);
  });
});
