// T-075's execution end to end against a real Postgres, with the provider faked: a decided refund is
// sent once, resolved only on the provider's own record of it, and a failure returns the money to the
// trade's liabilities exactly once. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/platform/logger.js';
import {
  accountBalance,
  decideRefund,
  trialBalance,
  type AccountRef,
  type InitiateRefundInput,
  type InitiateRefundResult,
  type VerifiedRefundView,
} from '../../../src/modules/ledger/index.js';
import { RefundNotFoundError } from '../../../src/modules/ledger/domain/refunds.js';
import { findRefund } from '../../../src/modules/ledger/infrastructure/postgres/refundsRepository.js';
import { recordDelivery } from '../../../src/modules/ledger/infrastructure/postgres/paymentsRepository.js';
import { processDelivery } from '../../../src/modules/ledger/services/webhookIngest.service.js';
import {
  FAILED_REASON,
  MAX_PENDING_MS,
  processRefund,
  RefundStillPendingError,
  resolveRefund,
  resolveRefundEvent,
  REVIEW_REASON,
  UNANSWERED_REASON,
  UNNAMED_MS,
  type RefundDispatchDeps,
} from '../../../src/modules/ledger/services/refundDispatch.service.js';
import { sweepInFlightRefunds } from '../../../src/modules/ledger/jobs/refund.job.js';
import { infraEnabled, testRedisEnv, testRedisUrl } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import {
  fundedTradeWithCharge,
  outboxOf,
  REFUND_FEE,
  REFUND_ITEM,
  type FundedTrade,
} from './refund-support.js';

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: testRedisUrl(),
  ...testRedisEnv(),
});
const logger = createLogger(config);

const TOTAL = REFUND_ITEM + REFUND_FEE;

describe.runIf(infraEnabled)('sending and resolving a refund (T-075)', () => {
  const t = useTestDatabase();

  const POOL: AccountRef = { type: 'PLATFORM_ESCROW_POOL' };
  const escrowOf = (trade: FundedTrade): AccountRef => ({
    type: 'USER_ESCROW_LIABILITY',
    tradeId: trade.tradeId,
  });
  const feeOf = (trade: FundedTrade): AccountRef => ({
    type: 'BUYER_PROTECTION_FEE_LIABILITY',
    tradeId: trade.tradeId,
  });
  const balance = async (ref: AccountRef) => (await accountBalance(t.db(), ref)).balanceMinor;

  /** A funded trade with its refund decided: the state the dispatch job starts from. */
  const decided = async () => {
    const trade = await fundedTradeWithCharge(t);
    const result = await t
      .db()
      .transaction((tx) =>
        decideRefund(tx, { logger }, { tradeId: trade.tradeId, reason: 'SELLER_CANNOT_FULFIL' }),
      );
    if (result.outcome !== 'REFUNDED') throw new Error(`refund not decided: ${result.outcome}`);
    return { trade, refundId: result.refundId };
  };

  /** A provider whose initiate answers `initiated` and whose fetch answers `record`. */
  const provider = (
    record: Partial<VerifiedRefundView> | Error,
    initiated: InitiateRefundResult | Error = { providerRefundId: 'RF_1', status: 'pending' },
    now?: () => Date,
  ) => {
    const initiateRefund = vi.fn((input: InitiateRefundInput) => {
      void input;
      return initiated instanceof Error ? Promise.reject(initiated) : Promise.resolve(initiated);
    });
    const verifyRefund = vi.fn((id: string) =>
      record instanceof Error
        ? Promise.reject(record)
        : Promise.resolve({
            providerRefundId: id,
            status: 'processed',
            amountMinor: Number(TOTAL),
            currency: 'NGN',
            ...record,
          }),
    );
    const deps: RefundDispatchDeps = {
      db: t.db(),
      logger,
      initiateRefund,
      verifyRefund,
      ...(now ? { now } : {}),
    };
    return { deps, initiateRefund, verifyRefund };
  };

  const completedFor = async (refundId: string) =>
    (await outboxOf(t, 'ledger.refund.completed')).filter((e) => e.refundId === refundId);

  it('sends the decided total against the original charge, and settles PROCESSED on the provider’s record', async () => {
    const { trade, refundId } = await decided();
    const poolAfterDecision = await balance(POOL);
    const p = provider({ status: 'processed' });

    expect(await processRefund(p.deps, refundId)).toBe('PROCESSED');
    expect(p.initiateRefund).toHaveBeenCalledTimes(1);
    expect(p.initiateRefund.mock.calls[0]?.[0]).toEqual({
      chargeProviderReference: trade.chargeReference,
      amountMinor: Number(TOTAL),
      reference: `refund-${refundId}`,
      reason: 'Komtru refund',
    });
    expect(p.verifyRefund).toHaveBeenCalledWith('RF_1');
    // Processing posts nothing: the decision already accounted for the money.
    expect(await balance(POOL)).toBe(poolAfterDecision);
    expect(await findRefund(t.db(), refundId)).toMatchObject({
      status: 'PROCESSED',
      providerRefundId: 'RF_1',
    });
    expect(await completedFor(refundId)).toEqual([
      expect.objectContaining({ outcome: 'PROCESSED', amountMinor: TOTAL.toString(), journalEntryId: null }),
    ]);
  });

  it('returns the money to the trade’s liabilities once when the provider says failed', async () => {
    const { trade, refundId } = await decided();
    const poolAfterDecision = await balance(POOL);
    const p = provider({ status: 'failed' });

    expect(await processRefund(p.deps, refundId)).toBe('FAILED');
    expect(await resolveRefund(p.deps, refundId)).toBe('FAILED');
    expect(await processRefund(p.deps, refundId)).toBe('FAILED');

    expect(await balance(escrowOf(trade))).toBe(REFUND_ITEM);
    expect(await balance(feeOf(trade))).toBe(REFUND_FEE);
    expect((await balance(POOL)) - poolAfterDecision).toBe(TOTAL);
    expect((await trialBalance(t.db()))[0]?.differenceMinor).toBe(0n);
    const events = await completedFor(refundId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'FAILED', reason: FAILED_REASON });
    expect(p.initiateRefund).toHaveBeenCalledTimes(1);
  });

  it('frees the trade for a new whole-trade refund once the old one has failed', async () => {
    const { trade, refundId } = await decided();
    await processRefund(provider({ status: 'failed' }).deps, refundId);
    const again = await t
      .db()
      .transaction((tx) =>
        decideRefund(tx, { logger }, { tradeId: trade.tradeId, reason: 'SELLER_CANNOT_FULFIL' }),
      );
    // The trade is still FUNDED in this fixture (nothing moved it), so the retry is money again.
    expect(again.outcome).toBe('REFUNDED');
    expect(await balance(escrowOf(trade))).toBe(0n);
  });

  it('polls a refund the provider is still working on, and hands it to a person after a week', async () => {
    const { refundId } = await decided();
    const pending = provider({ status: 'processing' });
    await expect(processRefund(pending.deps, refundId)).rejects.toBeInstanceOf(RefundStillPendingError);
    expect((await findRefund(t.db(), refundId))?.status).toBe('PROCESSING');

    const later = provider(
      { status: 'processing' },
      undefined,
      () => new Date(Date.now() + MAX_PENDING_MS + 1),
    );
    expect(await resolveRefund(later.deps, refundId)).toBe('NEEDS_REVIEW');
    expect(later.initiateRefund).not.toHaveBeenCalled();
  });

  it('posts nothing and asks a person when the provider’s record is not this refund', async () => {
    const { trade, refundId } = await decided();
    const p = provider({ status: 'processed', amountMinor: Number(REFUND_ITEM) });
    expect(await processRefund(p.deps, refundId)).toBe('NEEDS_REVIEW');
    expect(await balance(escrowOf(trade))).toBe(0n);
    expect(await completedFor(refundId)).toEqual([
      expect.objectContaining({ outcome: 'NEEDS_REVIEW', reason: REVIEW_REASON }),
    ]);
    // Review is a person's: no automatic resolution moves it on.
    expect(await resolveRefund(provider({ status: 'processed' }).deps, refundId)).toBe('NEEDS_REVIEW');
  });

  it('asks a person when the provider has no record of a refund it named', async () => {
    const { refundId } = await decided();
    expect(await processRefund(provider(new RefundNotFoundError('RF_1')).deps, refundId)).toBe(
      'NEEDS_REVIEW',
    );
  });

  describe('an initiate that fails or goes unanswered', () => {
    it('is never sent again, and goes to review after an hour if nothing names it', async () => {
      const { refundId } = await decided();
      const p = provider({ status: 'processed' }, new Error('socket hang up'));

      expect(await processRefund(p.deps, refundId)).toBe('PROCESSING');
      expect(await processRefund(p.deps, refundId)).toBe('PROCESSING');
      expect(p.initiateRefund).toHaveBeenCalledTimes(1);
      expect(p.verifyRefund).not.toHaveBeenCalled();
      expect(await findRefund(t.db(), refundId)).toMatchObject({
        status: 'PROCESSING',
        providerRefundId: null,
      });
      expect((await findRefund(t.db(), refundId))?.lastError).toContain('Error');

      const later = provider({ status: 'processed' }, undefined, () => new Date(Date.now() + UNNAMED_MS + 1));
      expect(await resolveRefund(later.deps, refundId)).toBe('NEEDS_REVIEW');
      expect((await completedFor(refundId))[0]).toMatchObject({ reason: UNANSWERED_REASON });
      expect(later.initiateRefund).not.toHaveBeenCalled();
    });

    it('is picked up by a webhook that names it by the original charge', async () => {
      const { trade, refundId } = await decided();
      const p = provider({ status: 'processed' }, new Error('timeout'));
      await processRefund(p.deps, refundId);

      expect(
        await resolveRefundEvent(p.deps, {
          provider: 'PAYSTACK',
          chargeReference: trade.chargeReference,
          providerRefundId: 'RF_LATE',
        }),
      ).toBe('PROCESSED');
      expect(await findRefund(t.db(), refundId)).toMatchObject({
        status: 'PROCESSED',
        providerRefundId: 'RF_LATE',
      });
      expect(p.initiateRefund).toHaveBeenCalledTimes(1);
    });
  });

  it('sends once when dispatches race', async () => {
    const { refundId } = await decided();
    const p = provider({ status: 'processed' });
    const outcomes = await Promise.allSettled(
      Array.from({ length: 4 }, () => processRefund(p.deps, refundId)),
    );
    expect(p.initiateRefund).toHaveBeenCalledTimes(1);
    expect(outcomes.some((o) => o.status === 'fulfilled' && o.value === 'PROCESSED')).toBe(true);
    expect(await completedFor(refundId)).toHaveLength(1);
  });

  it('resolves a refund webhook on the provider’s record, not on its body', async () => {
    const { trade, refundId } = await decided();
    const p = provider({ status: 'failed' });
    await expect(processRefund(provider({ status: 'pending' }).deps, refundId)).rejects.toBeInstanceOf(
      RefundStillPendingError,
    );
    const deliver = async (providerRefundId: string) => {
      const delivery = await recordDelivery(t.db(), {
        provider: 'PAYSTACK',
        providerEventId: `refund.processed:${randomUUID()}`,
        eventType: 'refund.processed',
        payload: { event: 'refund.processed', data: { id: providerRefundId } },
      });
      return processDelivery(
        {
          db: t.db(),
          logger,
          verify: () => Promise.reject(new Error('not a charge')),
          // The body says processed; the provider's record says failed, and that is what is acted on.
          parse: () => ({
            type: 'refund.processed',
            reference: trade.chargeReference,
            providerRefundId,
            amountMinor: Number(TOTAL),
          }),
          resolveRefund: (event) => resolveRefundEvent(p.deps, { provider: 'PAYSTACK', ...event }),
        },
        delivery.id,
      );
    };
    expect(await deliver('RF_1')).toBe('FAILED');
    expect(await deliver('RF_UNKNOWN')).toBe('UNKNOWN_REFERENCE');
  });

  it('re-queues a decided refund whose dispatch never ran', async () => {
    const { refundId } = await decided();
    const enqueue = vi.fn(() => Promise.resolve());
    await sweepInFlightRefunds({ db: t.db(), logger, enqueue, now: new Date(Date.now() + 10 * 60_000) });
    expect(enqueue).toHaveBeenCalledWith(refundId);
  });
});
