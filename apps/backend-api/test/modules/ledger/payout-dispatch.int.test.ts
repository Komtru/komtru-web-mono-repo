// T-073 against a real Postgres: sending a payout, settling it on transfer verify, the transfer
// webhooks, the automatic triggers and the backstop sweep. The assertions are balances: after every
// terminal outcome the payout's clearing account is zero, and the seller's payable holds exactly what
// it should. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/platform/logger.js';
import {
  accountBalance,
  executePayout,
  placePayoutHold,
  postJournal,
  TransferNotFoundError,
  trialBalance,
  type AccountRef,
  type VerifiedTransferView,
} from '../../../src/modules/ledger/index.js';
import {
  insertPayoutAccount,
  findPayout,
  upsertPayoutMode,
} from '../../../src/modules/ledger/infrastructure/postgres/payoutsRepository.js';
import {
  findDelivery,
  recordDelivery,
} from '../../../src/modules/ledger/infrastructure/postgres/paymentsRepository.js';
import {
  BANK_FAILED_REASON,
  HELD_REASON,
  REVIEW_REASON,
  STUCK_REASON,
  PayoutStillPendingError,
  processPayout,
  resolvePayout,
  type PayoutDispatchDeps,
} from '../../../src/modules/ledger/services/payoutDispatch.service.js';
import {
  payOutRelease,
  sweepAutoPayouts,
  sweepInFlightPayouts,
} from '../../../src/modules/ledger/services/payoutTriggers.service.js';
import { processDelivery } from '../../../src/modules/ledger/services/webhookIngest.service.js';
import type { PayoutRow } from '../../../src/modules/ledger/infrastructure/postgres/schema/payouts.js';
import { infraEnabled, testRedisEnv, testRedisUrl } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: testRedisUrl(),
  ...testRedisEnv(),
});
const logger = createLogger(config);
const PAYOUT_FEE = 2_500n;
const fee = () => ({ version: 'test-fee-schedule', currency: 'NGN', amountMinor: PAYOUT_FEE });

/** A Monday and a Tuesday, both 09:00 in Lagos (UTC+1). */
const MONDAY = new Date('2026-11-09T08:00:00Z');
const TUESDAY = new Date('2026-11-10T08:00:00Z');

describe.runIf(infraEnabled)('payout dispatch and resolution (T-073)', () => {
  const t = useTestDatabase();

  const POOL: AccountRef = { type: 'PLATFORM_ESCROW_POOL' };
  const REVENUE: AccountRef = { type: 'PLATFORM_FEE_REVENUE' };
  const payableOf = (userId: string): AccountRef => ({ type: 'USER_PAYABLE', ownerUserId: userId });
  const clearingOf = (payoutId: string): AccountRef => ({ type: 'SETTLEMENT_CLEARING', payoutId });
  const balance = async (ref: AccountRef) => (await accountBalance(t.db(), ref)).balanceMinor;
  const balanced = async () => (await trialBalance(t.db())).every((row) => row.differenceMinor === 0n);

  const credit = async (userId: string, amountMinor: bigint) =>
    t.db().transaction((tx) =>
      postJournal(tx, {
        idempotencyKey: `test:release:${randomUUID()}`,
        description: 'test release',
        lines: [
          { account: POOL, direction: 'DEBIT', amountMinor },
          { account: payableOf(userId), direction: 'CREDIT', amountMinor },
        ],
      }),
    );

  const verifiedAccount = (userId: string) =>
    insertPayoutAccount(t.db(), {
      userId,
      provider: 'PAYSTACK',
      bankCode: '058',
      accountNumberEnc: 'v1:test',
      accountNumberMasked: '******5567',
      accountNumberHash: Buffer.from(randomUUID()),
      status: 'VERIFIED',
      accountName: 'ADA OKAFOR',
      providerRecipientId: 'RCP_test',
      verifiedAt: new Date(),
      isDefault: true,
    });

  /** A seller with `held` in their payable, a verified default account, and one payout of `amount`. */
  const aPayout = async (amount = 60_000n, held = 100_000n) => {
    const seller = randomUUID();
    await credit(seller, held);
    await verifiedAccount(seller);
    const result = await t
      .db()
      .transaction((tx) =>
        executePayout(tx, { logger, fee }, { userId: seller, amountMinor: amount, trigger: 'MANUAL' }),
      );
    if (result.outcome !== 'CREATED') throw new Error(`no payout: ${result.outcome}`);
    return { seller, payout: result.payout };
  };

  const answer = (payout: PayoutRow, status: string, overrides: Partial<VerifiedTransferView> = {}) => ({
    reference: payout.reference,
    status,
    amountMinor: Number(payout.transferAmountMinor),
    currency: 'NGN',
    providerTransferId: 'TRF_1',
    ...overrides,
  });

  /** A provider that accepts the transfer and then answers verify with each status in turn. */
  const provider = (payout: PayoutRow, ...statuses: (string | Error)[]) => {
    const queue = [...statuses];
    const initiateTransfer = vi.fn(() =>
      Promise.resolve({ providerTransferId: 'TRF_1', status: 'pending' as const }),
    );
    const verifyTransfer = vi.fn(() => {
      const next = queue.length > 1 ? queue.shift()! : queue[0]!;
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(answer(payout, next));
    });
    const deps: PayoutDispatchDeps = { db: t.db(), logger, initiateTransfer, verifyTransfer };
    return { deps, initiateTransfer, verifyTransfer };
  };

  const outbox = async (eventType: string) => {
    const { rows } = await t
      .owner()
      .query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM platform.outbox WHERE event_type = $1 ORDER BY occurred_at`,
        [eventType],
      );
    return rows.map((row) => row.payload);
  };

  const status = async (id: string) => (await findPayout(t.db(), id))?.status;

  it('sends, settles on verify, and leaves clearing at zero with the cash out of the pool', async () => {
    const { seller, payout } = await aPayout();
    const p = provider(payout, 'success');
    const poolBefore = await balance(POOL);

    expect(await processPayout(p.deps, payout.id)).toBe('SUCCEEDED');
    expect(p.initiateTransfer).toHaveBeenCalledWith({
      providerRecipientId: 'RCP_test',
      amountMinor: Number(60_000n - PAYOUT_FEE),
      reference: payout.reference,
      reason: 'Komtru payout',
    });
    expect(await balance(clearingOf(payout.id))).toBe(0n);
    expect(await balance(POOL)).toBe(poolBefore - (60_000n - PAYOUT_FEE));
    expect(await balance(payableOf(seller))).toBe(40_000n);
    expect(await balance(REVENUE)).toBe(PAYOUT_FEE);
    expect(await balanced()).toBe(true);

    const row = await findPayout(t.db(), payout.id);
    expect(row).toMatchObject({
      status: 'SUCCEEDED',
      providerTransferId: 'TRF_1',
      lastProviderStatus: 'success',
    });
    expect(row?.settledJournalId).not.toBeNull();
    expect(await outbox('ledger.payout.completed')).toEqual([
      expect.objectContaining({ payoutId: payout.id, outcome: 'SUCCEEDED' }),
    ]);

    // A second run, a webhook replay: nothing is sent and nothing posts again.
    expect(await processPayout(p.deps, payout.id)).toBe('SUCCEEDED');
    expect(p.initiateTransfer).toHaveBeenCalledTimes(1);
    expect(await outbox('ledger.payout.completed')).toHaveLength(1);
  });

  it('waits while the transfer is pending, never sending it twice', async () => {
    const { payout } = await aPayout();
    const p = provider(payout, 'pending', 'otp', 'success');
    await expect(processPayout(p.deps, payout.id)).rejects.toBeInstanceOf(PayoutStillPendingError);
    expect(await status(payout.id)).toBe('PROCESSING');
    await expect(processPayout(p.deps, payout.id)).rejects.toBeInstanceOf(PayoutStillPendingError);
    expect(await processPayout(p.deps, payout.id)).toBe('SUCCEEDED');
    expect(p.initiateTransfer).toHaveBeenCalledTimes(1);
  });

  it('leaves a payout whose send failed in flight, and resends only when verify proves nothing was sent', async () => {
    const { seller, payout } = await aPayout();
    const p = provider(payout, new TransferNotFoundError(payout.reference), 'success');
    p.initiateTransfer.mockRejectedValueOnce(new Error('socket hang up'));

    await expect(processPayout(p.deps, payout.id)).rejects.toThrow('socket hang up');
    // Never reversed: the provider may have the money on its way.
    expect(await status(payout.id)).toBe('PROCESSING');
    expect(await balance(payableOf(seller))).toBe(40_000n);

    await expect(processPayout(p.deps, payout.id)).rejects.toBeInstanceOf(PayoutStillPendingError);
    expect(p.initiateTransfer).toHaveBeenCalledTimes(2);
    expect(
      p.initiateTransfer.mock.calls.map((c) => (c as unknown as [{ reference: string }])[0].reference),
    ).toEqual([payout.reference, payout.reference]);
    expect(await processPayout(p.deps, payout.id)).toBe('SUCCEEDED');
  });

  it('gives the whole amount, fee included, back to the payable when the bank fails it', async () => {
    const { seller, payout } = await aPayout();
    const p = provider(payout, 'failed');
    expect(await processPayout(p.deps, payout.id)).toBe('FAILED');
    expect(await balance(payableOf(seller))).toBe(100_000n);
    expect(await balance(clearingOf(payout.id))).toBe(0n);
    expect(await balance(REVENUE)).toBe(0n);
    expect(await findPayout(t.db(), payout.id)).toMatchObject({
      status: 'FAILED',
      failureReason: BANK_FAILED_REASON,
    });
    expect(await balanced()).toBe(true);
  });

  it('returns a paid transfer the bank sends back, from the pool to the payable', async () => {
    const { seller, payout } = await aPayout();
    const poolBefore = await balance(POOL);
    const p = provider(payout, 'success', 'reversed');
    expect(await processPayout(p.deps, payout.id)).toBe('SUCCEEDED');
    expect(await resolvePayout(p.deps, payout.id)).toBe('REVERSED');

    expect(await balance(payableOf(seller))).toBe(100_000n);
    expect(await balance(POOL)).toBe(poolBefore);
    expect(await balance(clearingOf(payout.id))).toBe(0n);
    expect(await balance(REVENUE)).toBe(0n);
    expect((await outbox('ledger.payout.completed')).map((e) => e.outcome)).toEqual([
      'SUCCEEDED',
      'REVERSED',
    ]);
    // And again: final.
    expect(await resolvePayout(p.deps, payout.id)).toBe('REVERSED');
    expect(await balanced()).toBe(true);
  });

  it.each([
    ['amount', { amountMinor: 1 }],
    ['currency', { currency: 'USD' }],
    ['reference', { reference: 'payout-someone-else' }],
  ])('holds a verified transfer whose %s differs for review, posting nothing', async (_what, overrides) => {
    const { payout } = await aPayout();
    const p = provider(payout, 'success');
    p.verifyTransfer.mockResolvedValue(answer(payout, 'success', overrides));
    expect(await processPayout(p.deps, payout.id)).toBe('NEEDS_REVIEW');
    expect(await balance(clearingOf(payout.id))).toBe(60_000n - PAYOUT_FEE);
    expect(await outbox('ledger.payout.completed')).toEqual([
      expect.objectContaining({ outcome: 'NEEDS_REVIEW', journalEntryId: null, reason: REVIEW_REASON }),
    ]);
  });

  it('returns a payout a hold catches at dispatch, without calling the provider', async () => {
    const { seller, payout } = await aPayout();
    await t.db().transaction((tx) =>
      placePayoutHold(tx, {
        userId: seller,
        holdType: 'PAYOUT_HOLD',
        source: 'RISK_RULE:test',
        reason: 'x',
      }),
    );
    const p = provider(payout, 'success');
    expect(await processPayout(p.deps, payout.id)).toBe('FAILED');
    expect(p.initiateTransfer).not.toHaveBeenCalled();
    expect(await balance(payableOf(seller))).toBe(100_000n);
    expect(await findPayout(t.db(), payout.id)).toMatchObject({ failureReason: HELD_REASON });
  });

  it('settles once when the webhook, the job and the sweep all verify at the same moment', async () => {
    const { payout } = await aPayout();
    const p = provider(payout, 'pending');
    await expect(processPayout(p.deps, payout.id)).rejects.toBeInstanceOf(PayoutStillPendingError);
    p.verifyTransfer.mockResolvedValue(answer(payout, 'success'));

    const outcomes = await Promise.all(Array.from({ length: 4 }, () => resolvePayout(p.deps, payout.id)));
    expect(outcomes).toEqual(['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED']);
    expect(await outbox('ledger.payout.completed')).toHaveLength(1);
    expect(await balance(clearingOf(payout.id))).toBe(0n);
  });

  it('settles a transfer webhook on verify, and ignores a reference that is not a payout', async () => {
    const { payout } = await aPayout();
    const p = provider(payout, 'pending');
    await expect(processPayout(p.deps, payout.id)).rejects.toBeInstanceOf(PayoutStillPendingError);
    p.verifyTransfer.mockResolvedValue(answer(payout, 'success'));

    const deliver = async (reference: string) => {
      const delivery = await recordDelivery(t.db(), {
        provider: 'PAYSTACK',
        providerEventId: `transfer.success:${randomUUID()}`,
        eventType: 'transfer.success',
        payload: { event: 'transfer.success', data: { reference } },
      });
      return processDelivery(
        {
          db: t.db(),
          logger,
          verify: () => Promise.reject(new Error('not a charge')),
          // The body says success; only the verify answer is acted on.
          parse: () => ({ type: 'transfer.success', reference, providerTransferId: 'TRF_1' }),
          resolvePayout: (id) => resolvePayout(p.deps, id),
        },
        delivery.id,
      );
    };
    expect(await deliver(payout.reference)).toBe('SUCCEEDED');
    expect(await deliver('fund-not-a-payout')).toBe('UNKNOWN_REFERENCE');
    expect(await deliver(`payout-${randomUUID()}`)).toBe('UNKNOWN_REFERENCE');
  });

  const placeHold = (userId: string) =>
    t
      .db()
      .transaction((tx) =>
        placePayoutHold(tx, { userId, holdType: 'PAYOUT_HOLD', source: 'RISK_RULE:test', reason: 'x' }),
      );

  it('stops a payout a hold catches after the claim, before anything is sent', async () => {
    const { seller, payout } = await aPayout();
    // The claim committed and the process died before the send: PROCESSING, nothing at the provider.
    await t
      .owner()
      .query(`UPDATE ledger.payouts SET status = 'PROCESSING', dispatched_at = now() WHERE id = $1`, [
        payout.id,
      ]);
    await placeHold(seller);
    const p = provider(payout, new TransferNotFoundError(payout.reference));

    expect(await processPayout(p.deps, payout.id)).toBe('FAILED');
    expect(p.initiateTransfer).not.toHaveBeenCalled();
    expect(await balance(payableOf(seller))).toBe(100_000n);
    expect(await balance(clearingOf(payout.id))).toBe(0n);
    expect(await findPayout(t.db(), payout.id)).toMatchObject({ failureReason: HELD_REASON });
    expect(await balanced()).toBe(true);
  });

  it('never resends past a hold placed after a send that went unanswered', async () => {
    const { seller, payout } = await aPayout();
    const p = provider(payout, new TransferNotFoundError(payout.reference));
    p.initiateTransfer.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(processPayout(p.deps, payout.id)).rejects.toThrow('socket hang up');

    await placeHold(seller);
    expect(await processPayout(p.deps, payout.id)).toBe('FAILED');
    expect(p.initiateTransfer).toHaveBeenCalledTimes(1);
    expect(await balance(payableOf(seller))).toBe(100_000n);
  });

  it('never resends to an account that is no longer payable', async () => {
    const { seller, payout } = await aPayout();
    const p = provider(payout, new TransferNotFoundError(payout.reference));
    p.initiateTransfer.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(processPayout(p.deps, payout.id)).rejects.toThrow('socket hang up');

    await t
      .owner()
      .query(
        `UPDATE ledger.payout_accounts SET status = 'DISABLED', is_default = false, disabled_at = now() WHERE id = $1`,
        [payout.payoutAccountId],
      );
    expect(await processPayout(p.deps, payout.id)).toBe('FAILED');
    expect(p.initiateTransfer).toHaveBeenCalledTimes(1);
    expect(await balance(payableOf(seller))).toBe(100_000n);
  });

  it('holds a transfer whose code is not the one the provider gave us for review', async () => {
    const { payout } = await aPayout();
    const p = provider(payout, 'success');
    p.verifyTransfer.mockResolvedValue(answer(payout, 'success', { providerTransferId: 'TRF_other' }));
    expect(await processPayout(p.deps, payout.id)).toBe('NEEDS_REVIEW');
    expect(await balance(clearingOf(payout.id))).toBe(60_000n - PAYOUT_FEE);
  });

  it('leaves a succeeded payout alone when a later verify does not match it', async () => {
    const { seller, payout } = await aPayout();
    const poolBefore = await balance(POOL);
    const p = provider(payout, 'success');
    expect(await processPayout(p.deps, payout.id)).toBe('SUCCEEDED');

    p.verifyTransfer.mockResolvedValue(answer(payout, 'reversed', { amountMinor: 1 }));
    expect(await resolvePayout(p.deps, payout.id)).toBe('SUCCEEDED');
    expect(await status(payout.id)).toBe('SUCCEEDED');
    expect(await balance(payableOf(seller))).toBe(40_000n);
    expect(await balance(POOL)).toBe(poolBefore - (60_000n - PAYOUT_FEE));
    expect(await outbox('ledger.payout.completed')).toHaveLength(1);
  });

  it('hands a transfer still not final after a day to a person, posting nothing', async () => {
    const { payout } = await aPayout();
    const p = provider(payout, 'otp');
    await expect(processPayout(p.deps, payout.id)).rejects.toBeInstanceOf(PayoutStillPendingError);

    const later = { ...p.deps, now: () => new Date(Date.now() + 25 * 60 * 60_000) };
    expect(await resolvePayout(later, payout.id)).toBe('NEEDS_REVIEW');
    expect(await balance(clearingOf(payout.id))).toBe(60_000n - PAYOUT_FEE);
    expect(await outbox('ledger.payout.completed')).toEqual([
      expect.objectContaining({ outcome: 'NEEDS_REVIEW', reason: STUCK_REASON, journalEntryId: null }),
    ]);
  });

  describe('a transfer webhook whose body says success', () => {
    const deliver = async (reference: string, deps: PayoutDispatchDeps) => {
      const delivery = await recordDelivery(t.db(), {
        provider: 'PAYSTACK',
        providerEventId: `transfer.success:${randomUUID()}`,
        eventType: 'transfer.success',
        payload: { event: 'transfer.success', data: { reference } },
      });
      const run = processDelivery(
        {
          db: t.db(),
          logger,
          verify: () => Promise.reject(new Error('not a charge')),
          parse: () => ({ type: 'transfer.success', reference, providerTransferId: 'TRF_1' }),
          resolvePayout: (id) => resolvePayout(deps, id),
        },
        delivery.id,
      );
      return { run, id: delivery.id };
    };

    it('fails the payout when verify says failed', async () => {
      const { seller, payout } = await aPayout();
      const p = provider(payout, 'pending');
      await expect(processPayout(p.deps, payout.id)).rejects.toBeInstanceOf(PayoutStillPendingError);
      p.verifyTransfer.mockResolvedValue(answer(payout, 'failed'));

      expect(await (await deliver(payout.reference, p.deps)).run).toBe('FAILED');
      expect(await balance(payableOf(seller))).toBe(100_000n);
      expect(await balance(clearingOf(payout.id))).toBe(0n);
    });

    it('posts nothing while verify says pending, and leaves the delivery for the retry', async () => {
      const { seller, payout } = await aPayout();
      const p = provider(payout, 'pending');
      await expect(processPayout(p.deps, payout.id)).rejects.toBeInstanceOf(PayoutStillPendingError);
      const poolBefore = await balance(POOL);

      const { run, id } = await deliver(payout.reference, p.deps);
      await expect(run).rejects.toBeInstanceOf(PayoutStillPendingError);
      expect(await status(payout.id)).toBe('PROCESSING');
      expect((await findDelivery(t.db(), id))?.processedAt).toBeNull();
      expect(await balance(POOL)).toBe(poolBefore);
      expect(await balance(payableOf(seller))).toBe(40_000n);
      expect(await outbox('ledger.payout.completed')).toEqual([]);
    });
  });

  describe('automatic payouts', () => {
    const released = (seller: string, journalEntryId: string, proceeds: bigint) => ({
      tradeId: randomUUID(),
      journalEntryId,
      sellerUserId: seller,
      currency: 'NGN',
      outcome: 'RELEASED' as const,
      itemAmountMinor: String(proceeds),
      sellerProceedsMinor: String(proceeds),
      commissionMinor: '0',
      refundToBuyerMinor: '0',
      buyerProtectionFeeMinor: '0',
      buyerProtectionFeeTreatment: 'RECOGNISE' as const,
      releasedAt: new Date().toISOString(),
    });

    it('pays out exactly the released proceeds, once per release, for an AUTO_IMMEDIATE seller', async () => {
      const seller = randomUUID();
      await credit(seller, 10_000n);
      const release = await credit(seller, 45_000n);
      await verifiedAccount(seller);
      const event = released(seller, release.journalEntry.id, 45_000n);

      expect(await t.db().transaction((tx) => payOutRelease(tx, { logger, fee }, event))).toBe(
        'NOT_AUTO_IMMEDIATE',
      );
      await t.db().transaction((tx) => upsertPayoutMode(tx, seller, 'AUTO_IMMEDIATE'));

      const first = await t.db().transaction((tx) => payOutRelease(tx, { logger, fee }, event));
      expect(first).toMatchObject({
        outcome: 'CREATED',
        payout: { trigger: 'AUTO_IMMEDIATE', amountMinor: 45_000n },
      });
      expect(await t.db().transaction((tx) => payOutRelease(tx, { logger, fee }, event))).toMatchObject({
        outcome: 'EXISTS',
      });
      expect(await balance(payableOf(seller))).toBe(10_000n);
    });

    it('skips, and says so, when there is no account or the balance no longer covers the credit', async () => {
      const seller = randomUUID();
      const release = await credit(seller, 45_000n);
      await t.db().transaction((tx) => upsertPayoutMode(tx, seller, 'AUTO_IMMEDIATE'));
      const event = released(seller, release.journalEntry.id, 45_000n);
      expect(await t.db().transaction((tx) => payOutRelease(tx, { logger, fee }, event))).toMatchObject({
        outcome: 'REFUSED',
        reason: 'NO_VERIFIED_ACCOUNT',
      });

      await verifiedAccount(seller);
      const bigger = released(seller, randomUUID(), 90_000n);
      // No partial payout (owner decision 4).
      expect(await t.db().transaction((tx) => payOutRelease(tx, { logger, fee }, bigger))).toMatchObject({
        outcome: 'REFUSED',
        reason: 'INSUFFICIENT_BALANCE',
      });
      expect((await outbox('ledger.payout.auto_skipped')).map((e) => e.reason)).toEqual([
        'NO_VERIFIED_ACCOUNT',
        'INSUFFICIENT_BALANCE',
      ]);
      expect(await balance(payableOf(seller))).toBe(45_000n);
    });

    it('sweeps the whole balance of daily users every day and weekly users on Monday, once a day', async () => {
      const daily = randomUUID();
      const weekly = randomUUID();
      const unready = randomUUID();
      for (const [user, mode] of [
        [daily, 'AUTO_DAILY'],
        [weekly, 'AUTO_WEEKLY'],
        [unready, 'AUTO_DAILY'],
      ] as const) {
        await credit(user, 30_000n);
        await t.db().transaction((tx) => upsertPayoutMode(tx, user, mode));
      }
      await verifiedAccount(daily);
      await verifiedAccount(weekly);

      const tuesday = await sweepAutoPayouts({ db: t.db(), logger, fee, now: () => TUESDAY });
      expect(tuesday).toMatchObject({ modes: ['AUTO_DAILY'], created: 1, skipped: 1 });
      expect(await balance(payableOf(daily))).toBe(0n);
      expect(await balance(payableOf(weekly))).toBe(30_000n);

      const monday = await sweepAutoPayouts({ db: t.db(), logger, fee, now: () => MONDAY });
      expect(monday.modes).toEqual(['AUTO_DAILY', 'AUTO_WEEKLY']);
      expect(await balance(payableOf(weekly))).toBe(0n);

      // The same day again pays nobody twice.
      await credit(weekly, 5_000n);
      const rerun = await sweepAutoPayouts({ db: t.db(), logger, fee, now: () => MONDAY });
      expect(rerun.created).toBe(0);
      expect(await balance(payableOf(weekly))).toBe(5_000n);
      expect(
        (await outbox('ledger.payout.auto_skipped')).filter((e) => e.userId === unready).map((e) => e.reason),
      ).toContain('NO_VERIFIED_ACCOUNT');
    });
  });

  it('does not re-sweep a day whose sweep payout failed; the money waits for the next due sweep', async () => {
    const user = randomUUID();
    await credit(user, 30_000n);
    await verifiedAccount(user);
    await t.db().transaction((tx) => upsertPayoutMode(tx, user, 'AUTO_DAILY'));

    expect((await sweepAutoPayouts({ db: t.db(), logger, fee, now: () => TUESDAY })).created).toBe(1);
    const { rows } = await t
      .owner()
      .query<{ id: string }>(`SELECT id FROM ledger.payouts WHERE user_id = $1`, [user]);
    const swept = (await findPayout(t.db(), rows[0]!.id))!;
    expect(await processPayout(provider(swept, 'failed').deps, swept.id)).toBe('FAILED');
    expect(await balance(payableOf(user))).toBe(30_000n);

    // Same day: the key is spent, so the failing bank is not tried again.
    expect(await sweepAutoPayouts({ db: t.db(), logger, fee, now: () => TUESDAY })).toMatchObject({
      created: 0,
      existing: 1,
    });
    // Next day: the returned money goes out with the rest.
    const wednesday = new Date(TUESDAY.getTime() + 24 * 60 * 60_000);
    expect((await sweepAutoPayouts({ db: t.db(), logger, fee, now: () => wednesday })).created).toBe(1);
    expect(await balance(payableOf(user))).toBe(0n);
  });

  it('refuses a payout fee priced in anything but naira, before writing anything', async () => {
    const seller = randomUUID();
    await credit(seller, 30_000n);
    await verifiedAccount(seller);
    await expect(
      t
        .db()
        .transaction((tx) =>
          executePayout(
            tx,
            { logger, fee: () => ({ ...fee(), currency: 'USD' }) },
            { userId: seller, amountMinor: 10_000n, trigger: 'MANUAL' },
          ),
        ),
    ).rejects.toThrow(/not NGN/);
    expect(await balance(payableOf(seller))).toBe(30_000n);
  });

  it('re-drives payouts whose job was lost, and leaves recent ones alone', async () => {
    const { payout } = await aPayout();
    const enqueuePayout = vi.fn(() => Promise.resolve());
    const enqueueAccount = vi.fn(() => Promise.resolve());
    const sweep = (ms: number) =>
      sweepInFlightPayouts({
        db: t.db(),
        logger,
        enqueuePayout,
        enqueueAccount,
        now: new Date(Date.now() + ms),
      });

    expect(await sweep(0)).toEqual({ payouts: 0, accounts: 0 });
    expect((await sweep(3 * 60_000)).payouts).toBe(1);
    expect(enqueuePayout).toHaveBeenCalledWith(payout.id);
  });
});
