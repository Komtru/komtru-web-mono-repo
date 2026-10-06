// postJournal: the only way money is written. The posting and the event announcing it share one
// transaction, a retried job posts once, and an unbalanced set is refused in the service and again
// by the database. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  IdempotencyKeyConflictError,
  postJournal,
  trialBalance,
  UnbalancedJournalError,
  type AccountRef,
  type JournalLineInput,
  type PostJournalInput,
} from '../../../src/modules/ledger/index.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { countRows, insertAccount, postRaw, sqlState } from './support.js';

/** A seeded PRNG, so a failing property case is reproducible from the seed in the name. */
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe.runIf(infraEnabled)('postJournal', () => {
  const t = useTestDatabase();

  const trade = randomUUID();
  const seller = randomUUID();
  const payout = randomUUID();

  const POOL: AccountRef = { type: 'PLATFORM_ESCROW_POOL' };
  const ESCROW: AccountRef = { type: 'USER_ESCROW_LIABILITY', tradeId: trade };
  const PAYABLE: AccountRef = { type: 'USER_PAYABLE', ownerUserId: seller };
  const FEE: AccountRef = { type: 'PLATFORM_FEE_REVENUE' };
  const CLEARING: AccountRef = { type: 'SETTLEMENT_CLEARING', payoutId: payout };

  const debit = (account: AccountRef, amountMinor: bigint): JournalLineInput => ({
    account,
    direction: 'DEBIT',
    amountMinor,
  });
  const credit = (account: AccountRef, amountMinor: bigint): JournalLineInput => ({
    account,
    direction: 'CREDIT',
    amountMinor,
  });

  const fundTrade = (amountMinor: bigint, key = `charge:${randomUUID()}`): PostJournalInput => ({
    idempotencyKey: key,
    description: 'escrow funded',
    tradeId: trade,
    provider: 'PAYSTACK',
    providerReference: 'psk_ref_1',
    lines: [debit(POOL, amountMinor), credit(ESCROW, amountMinor)],
  });

  const post = (input: PostJournalInput) => t.db().transaction((tx) => postJournal(tx, input));

  const outboxTypes = async (): Promise<string[]> => {
    const { rows } = await t
      .app()
      .query<{ event_type: string }>('SELECT event_type FROM platform.outbox ORDER BY seq');
    return rows.map((row) => row.event_type);
  };

  it('posts a balanced funding entry and writes the event in the same transaction', async () => {
    const posted = await post(fundTrade(5_000_000n));
    expect(posted.posted).toBe(true);
    expect(posted.lines).toHaveLength(2);
    expect(posted.journalEntry.lineCount).toBe(2);
    expect(await outboxTypes()).toEqual(['ledger.journal.posted']);
  });

  it('carries the account names and amounts on the event', async () => {
    await post(fundTrade(5_000_000n));
    const { rows } = await t
      .app()
      .query<{ payload: { lines: { accountKey: string; amountMinor: string }[] } }>(
        'SELECT payload FROM platform.outbox LIMIT 1',
      );
    const lines = rows[0]?.payload.lines ?? [];
    expect(lines.map((line) => line.accountKey).sort()).toEqual([
      'NGN:PLATFORM_ESCROW_POOL:-',
      `NGN:USER_ESCROW_LIABILITY:${trade}`,
    ]);
    expect(lines.every((line) => typeof line.amountMinor === 'string')).toBe(true);
  });

  it('writes neither the entry nor the event when the transaction rolls back', async () => {
    await expect(
      t.db().transaction(async (tx) => {
        await postJournal(tx, fundTrade(5_000_000n));
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    expect(await countRows(t.app(), 'ledger.ledger_entries')).toBe(0);
    expect(await countRows(t.app(), 'platform.outbox')).toBe(0);
  });

  it('rejects an unbalanced input before it reaches the database', async () => {
    const input = fundTrade(10_000n);
    await expect(
      post({ ...input, lines: [debit(POOL, 10_000n), credit(ESCROW, 9_999n)] }),
    ).rejects.toBeInstanceOf(UnbalancedJournalError);
    expect(await countRows(t.app(), 'ledger.ledger_journal_entries')).toBe(0);
  });

  it('rejects a single-line posting', async () => {
    const input = fundTrade(10_000n);
    await expect(post({ ...input, lines: [debit(POOL, 10_000n)] })).rejects.toThrow();
    expect(await countRows(t.app(), 'ledger.ledger_journal_entries')).toBe(0);
  });

  it('rejects a key with no namespace', async () => {
    await expect(post({ ...fundTrade(10_000n), idempotencyKey: 'abc123' })).rejects.toThrow();
  });

  it('posts once for a retried job', async () => {
    const input = fundTrade(5_000_000n, `charge:${randomUUID()}`);
    const first = await post(input);
    const second = await post(input);
    expect(second.posted).toBe(false);
    expect(second.journalEntry.id).toBe(first.journalEntry.id);
    expect(second.lines.map((line) => line.id).sort()).toEqual(first.lines.map((line) => line.id).sort());
    expect(await countRows(t.app(), 'ledger.ledger_entries')).toBe(2);
    expect(await outboxTypes()).toEqual(['ledger.journal.posted']);
  });

  it('posts once when ten overlapping retries race for the key', async () => {
    const input = fundTrade(5_000_000n, `charge:${randomUUID()}`);
    const results = await Promise.all(Array.from({ length: 10 }, () => post(input)));
    expect(results.filter((result) => result.posted)).toHaveLength(1);
    expect(new Set(results.map((result) => result.journalEntry.id)).size).toBe(1);
    expect(await countRows(t.app(), 'ledger.ledger_entries')).toBe(2);
    expect(await countRows(t.app(), 'platform.outbox')).toBe(1);
  });

  // A replay must be a replay. Returning the first posting for a second, different one would let a
  // caller fix a bug, retry, get a silent success, and leave the wrong money posted.
  it('refuses a replay whose lines differ from the original posting', async () => {
    const key = `charge:${randomUUID()}`;
    await post(fundTrade(5_000_000n, key));
    await expect(
      post({
        ...fundTrade(4_000_000n, key),
      }),
    ).rejects.toBeInstanceOf(IdempotencyKeyConflictError);
    expect(await countRows(t.app(), 'ledger.ledger_entries')).toBe(2);
  });

  it('refuses a replay with a different line count', async () => {
    const key = `trade:${trade}:release`;
    await post({
      idempotencyKey: key,
      description: 'escrow released',
      lines: [debit(ESCROW, 5_000_000n), credit(PAYABLE, 5_000_000n)],
    });
    await expect(
      post({
        idempotencyKey: key,
        description: 'escrow released',
        lines: [debit(ESCROW, 5_000_000n), credit(PAYABLE, 4_750_000n), credit(FEE, 250_000n)],
      }),
    ).rejects.toBeInstanceOf(IdempotencyKeyConflictError);
  });

  it('refuses a replay against a different account', async () => {
    const key = `payout:${payout}:initiated`;
    await post({
      idempotencyKey: key,
      description: 'payout initiated',
      lines: [debit(PAYABLE, 1_000n), credit(CLEARING, 1_000n)],
    });
    await expect(
      post({
        idempotencyKey: key,
        description: 'payout initiated',
        lines: [debit(ESCROW, 1_000n), credit(CLEARING, 1_000n)],
      }),
    ).rejects.toBeInstanceOf(IdempotencyKeyConflictError);
  });

  it('accepts a replay that matches, whatever order the lines arrive in', async () => {
    const key = `charge:${randomUUID()}`;
    const first = await post({
      idempotencyKey: key,
      description: 'escrow funded',
      lines: [debit(POOL, 5_000_000n), credit(ESCROW, 5_000_000n)],
    });
    const second = await post({
      idempotencyKey: key,
      description: 'escrow funded',
      lines: [credit(ESCROW, 5_000_000n), debit(POOL, 5_000_000n)],
    });
    expect(second.posted).toBe(false);
    expect(second.journalEntry.id).toBe(first.journalEntry.id);
  });

  it('returns the lines in the order they were posted', async () => {
    const posted = await post({
      idempotencyKey: `trade:${trade}:split`,
      description: 'released with a fee',
      lines: [debit(ESCROW, 5_000_000n), credit(PAYABLE, 4_750_000n), credit(FEE, 250_000n)],
    });
    expect(posted.lines.map((line) => line.accountType)).toEqual([
      'USER_ESCROW_LIABILITY',
      'USER_PAYABLE',
      'PLATFORM_FEE_REVENUE',
    ]);
    expect(posted.lines.map((line) => line.amountMinor)).toEqual([5_000_000n, 4_750_000n, 250_000n]);
  });

  it('keeps two different postings apart', async () => {
    await post(fundTrade(5_000_000n));
    await post(fundTrade(5_000_000n));
    expect(await countRows(t.app(), 'ledger.ledger_journal_entries')).toBe(2);
    expect(await countRows(t.app(), 'ledger.ledger_entries')).toBe(4);
  });

  // M8 §4's worked example, in kobo: a ₦50,000 trade with a ₦2,500 platform fee.
  it('walks the M8 §4 worked example end to end', async () => {
    const item = 5_000_000n;
    const fee = 250_000n;
    const net = item - fee;

    await post(fundTrade(item));
    expect((await accountBalance(t.db(), POOL)).balanceMinor).toBe(item);
    expect((await accountBalance(t.db(), ESCROW)).balanceMinor).toBe(item);

    await post({
      idempotencyKey: `trade:${trade}:release`,
      description: 'escrow released',
      tradeId: trade,
      lines: [debit(ESCROW, item), credit(FEE, fee), credit(PAYABLE, net)],
    });
    expect((await accountBalance(t.db(), ESCROW)).balanceMinor).toBe(0n);
    expect((await accountBalance(t.db(), FEE)).balanceMinor).toBe(fee);
    expect((await accountBalance(t.db(), PAYABLE)).balanceMinor).toBe(net);

    await post({
      idempotencyKey: `payout:${payout}:initiated`,
      description: 'payout initiated',
      lines: [debit(PAYABLE, net), credit(CLEARING, net)],
    });
    expect((await accountBalance(t.db(), PAYABLE)).balanceMinor).toBe(0n);
    expect((await accountBalance(t.db(), CLEARING)).balanceMinor).toBe(net);

    await post({
      idempotencyKey: `payout:${payout}:completed`,
      description: 'payout completed',
      provider: 'PAYSTACK',
      providerReference: 'trf_1',
      lines: [debit(CLEARING, net), credit(POOL, net)],
    });
    expect((await accountBalance(t.db(), CLEARING)).balanceMinor).toBe(0n);
    expect((await accountBalance(t.db(), POOL)).balanceMinor).toBe(fee);

    expect((await trialBalance(t.db()))[0]?.differenceMinor).toBe(0n);
  });

  it('refunds the escrow back to the pool', async () => {
    const item = 5_000_000n;
    await post(fundTrade(item));
    await post({
      idempotencyKey: `trade:${trade}:refund`,
      description: 'escrow refunded',
      tradeId: trade,
      lines: [debit(ESCROW, item), credit(POOL, item)],
    });
    expect((await accountBalance(t.db(), ESCROW)).balanceMinor).toBe(0n);
    expect((await accountBalance(t.db(), POOL)).balanceMinor).toBe(0n);
    expect((await trialBalance(t.db()))[0]?.differenceMinor).toBe(0n);
  });

  it('accepts every randomly generated balanced line set', async () => {
    const random = mulberry32(20261005);
    const accounts: AccountRef[] = [POOL, ESCROW, PAYABLE, FEE, CLEARING];
    for (let i = 0; i < 50; i += 1) {
      const creditCount = 1 + Math.floor(random() * 3);
      const amounts = Array.from({ length: creditCount }, () =>
        BigInt(1 + Math.floor(random() * 1_000_000_000)),
      );
      const total = amounts.reduce((sum, amount) => sum + amount, 0n);
      const lines: JournalLineInput[] = [
        debit(accounts[Math.floor(random() * accounts.length)] ?? POOL, total),
        ...amounts.map((amount) => credit(accounts[Math.floor(random() * accounts.length)] ?? FEE, amount)),
      ];
      await post({
        idempotencyKey: `prop:balanced:${i}`,
        description: `property case ${i}`,
        lines,
      });
    }
    expect(await countRows(t.app(), 'ledger.ledger_journal_entries')).toBe(50);
    for (const row of await trialBalance(t.db())) expect(row.differenceMinor).toBe(0n);
  });

  it('rejects every randomly generated unbalanced line set, in the service and in the database', async () => {
    const random = mulberry32(5102026);
    const pool = await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL');
    const escrow = await insertAccount(t.app(), 'USER_ESCROW_LIABILITY', { trade_id: trade });
    for (let i = 0; i < 50; i += 1) {
      const debitMinor = BigInt(1 + Math.floor(random() * 1_000_000_000));
      const drift = BigInt(1 + Math.floor(random() * 1000));
      const creditMinor = random() < 0.5 ? debitMinor + drift : debitMinor - drift;
      if (creditMinor <= 0n) continue;

      await expect(
        post({
          idempotencyKey: `prop:unbalanced:${i}`,
          description: `property case ${i}`,
          lines: [debit(POOL, debitMinor), credit(ESCROW, creditMinor)],
        }),
      ).rejects.toBeInstanceOf(UnbalancedJournalError);

      // The same lines written straight to the tables, with postJournal out of the way.
      expect(
        await sqlState(
          postRaw(t.app(), [
            { accountId: pool, direction: 'DEBIT', amountMinor: debitMinor },
            { accountId: escrow, direction: 'CREDIT', amountMinor: creditMinor },
          ]),
        ),
      ).toBe('KT010');
    }
    expect(await countRows(t.app(), 'ledger.ledger_journal_entries')).toBe(0);
  });
});
