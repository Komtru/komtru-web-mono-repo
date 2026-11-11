// T-075's decision end to end against a real Postgres: a funded trade asks for its money back, the
// ledger decides once, and what the trade owes afterwards is nothing — on either liability — while
// the pool has paid the buyer exactly what Q4 says. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../src/platform/logger.js';
import { loadConfig } from '../../../src/config/env.js';
import {
  accountBalance,
  decideRefund,
  postJournal,
  releaseEscrow,
  trialBalance,
  type AccountRef,
  type RefundResult,
} from '../../../src/modules/ledger/index.js';
import { infraEnabled, testRedisEnv, testRedisUrl } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { insertRow } from '../trades/support.js';
import {
  listMyRefunds,
  listRefundsForTrade,
} from '../../../src/modules/ledger/services/refundQuery.service.js';
import { ApiError } from '../../../src/platform/errors.js';
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
const deps = { logger: createLogger(config) };

const ITEM = REFUND_ITEM;
const FEE = REFUND_FEE;

describe.runIf(infraEnabled)('deciding a refund (T-075)', () => {
  const t = useTestDatabase();

  const ESCROW = (trade: FundedTrade): AccountRef => ({
    type: 'USER_ESCROW_LIABILITY',
    tradeId: trade.tradeId,
  });
  const FEE_LIABILITY = (trade: FundedTrade): AccountRef => ({
    type: 'BUYER_PROTECTION_FEE_LIABILITY',
    tradeId: trade.tradeId,
  });
  const POOL: AccountRef = { type: 'PLATFORM_ESCROW_POOL' };
  const FEE_REVENUE: AccountRef = { type: 'BUYER_PROTECTION_FEE_REVENUE' };
  const balance = async (ref: AccountRef) => (await accountBalance(t.db(), ref)).balanceMinor;

  const refund = (trade: FundedTrade, overrides: Partial<Parameters<typeof decideRefund>[2]> = {}) =>
    t
      .db()
      .transaction((tx) =>
        decideRefund(tx, deps, { tradeId: trade.tradeId, reason: 'SELLER_CANNOT_FULFIL', ...overrides }),
      );

  const refundRows = async (trade: FundedTrade) => {
    const { rows } = await t
      .app()
      .query<Record<string, unknown>>(`SELECT * FROM ledger.refunds WHERE trade_id = $1`, [trade.tradeId]);
    return rows;
  };

  const refused = (result: RefundResult): string => {
    expect(result.outcome).toBe('NOT_REFUNDABLE');
    return result.outcome === 'NOT_REFUNDABLE' ? result.reason : '';
  };

  describe('a whole-trade refund with the fee refundable (Q4)', () => {
    it('returns the item and the fee, and leaves both liabilities at zero', async () => {
      const trade = await fundedTradeWithCharge(t);
      const poolBefore = await balance(POOL);
      const result = await refund(trade);

      expect(result.outcome).toBe('REFUNDED');
      expect(await balance(ESCROW(trade))).toBe(0n);
      expect(await balance(FEE_LIABILITY(trade))).toBe(0n);
      expect(poolBefore - (await balance(POOL))).toBe(ITEM + FEE);
      expect((await trialBalance(t.db()))[0]?.differenceMinor).toBe(0n);
    });

    it('writes the refund against the trade’s own settled charge', async () => {
      const trade = await fundedTradeWithCharge(t);
      const result = await refund(trade);
      const [row, ...rest] = await refundRows(trade);
      expect(rest).toHaveLength(0);
      expect(row).toMatchObject({
        id: result.outcome === 'REFUNDED' ? result.refundId : 'none',
        payment_attempt_id: trade.attemptId,
        charge_reference: trade.chargeReference,
        buyer_user_id: trade.buyer,
        scope: 'FULL',
        status: 'REQUESTED',
        reason: 'SELLER_CANNOT_FULFIL',
        item_amount_minor: ITEM.toString(),
        fee_amount_minor: FEE.toString(),
        amount_minor: (ITEM + FEE).toString(),
        fee_treatment: 'REFUND',
      });
    });

    it('announces it once, with what it posted', async () => {
      const trade = await fundedTradeWithCharge(t);
      await refund(trade);
      const events = (await outboxOf(t, 'ledger.payment.escrow_refunded')).filter(
        (e) => e.tradeId === trade.tradeId,
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        buyerUserId: trade.buyer,
        reason: 'SELLER_CANNOT_FULFIL',
        scope: 'FULL',
        itemAmountMinor: ITEM.toString(),
        feeAmountMinor: FEE.toString(),
        amountMinor: (ITEM + FEE).toString(),
        buyerProtectionFeeTreatment: 'REFUND',
      });
    });
  });

  it('keeps the fee as revenue when the trade froze it as not refundable', async () => {
    const trade = await fundedTradeWithCharge(t, { refundableOnFullRefund: false });
    const revenueBefore = await balance(FEE_REVENUE);
    const poolBefore = await balance(POOL);
    const result = await refund(trade);

    expect(result.outcome).toBe('REFUNDED');
    expect(await balance(ESCROW(trade))).toBe(0n);
    expect(await balance(FEE_LIABILITY(trade))).toBe(0n);
    expect(poolBefore - (await balance(POOL))).toBe(ITEM);
    expect((await balance(FEE_REVENUE)) - revenueBefore).toBe(FEE);
    expect((await refundRows(trade))[0]).toMatchObject({
      amount_minor: ITEM.toString(),
      fee_amount_minor: '0',
      fee_treatment: 'RECOGNISE',
    });
  });

  describe('asked twice', () => {
    it('decides once however many times it is asked, in sequence', async () => {
      const trade = await fundedTradeWithCharge(t);
      const first = await refund(trade);
      const second = await refund(trade, { reason: 'DELIVERY_OVERDUE' });
      expect(first.outcome).toBe('REFUNDED');
      expect(second).toEqual({
        outcome: 'ALREADY_REFUNDED',
        refundId: first.outcome === 'REFUNDED' ? first.refundId : '',
      });
      expect(await refundRows(trade)).toHaveLength(1);
      expect(await balance(ESCROW(trade))).toBe(0n);
    });

    it('decides once when transactions race it', async () => {
      const trade = await fundedTradeWithCharge(t);
      const poolBefore = await balance(POOL);
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => refund(trade)));
      const decided = results.filter((r) => r.status === 'fulfilled' && r.value.outcome === 'REFUNDED');

      expect(decided).toHaveLength(1);
      expect(await refundRows(trade)).toHaveLength(1);
      expect(poolBefore - (await balance(POOL))).toBe(ITEM + FEE);
      expect(await balance(ESCROW(trade))).toBe(0n);
      expect(
        (await outboxOf(t, 'ledger.payment.escrow_refunded')).filter((e) => e.tradeId === trade.tradeId),
      ).toHaveLength(1);
    });
  });

  describe('refusals, none of which move money', () => {
    it('refuses a trade that is not funded, or has moved on', async () => {
      const shipped = await fundedTradeWithCharge(t, { status: 'SHIPPED' });
      expect(refused(await refund(shipped))).toMatch(/SHIPPED, not FUNDED/);
      expect(await balance(ESCROW(shipped))).toBe(ITEM);
      expect(await refundRows(shipped)).toHaveLength(0);
    });

    it('refuses a trade with no settled charge', async () => {
      const trade = await fundedTradeWithCharge(t);
      await t.owner().query(`ALTER TABLE ledger.payment_attempts DISABLE TRIGGER USER`);
      try {
        await t
          .owner()
          .query(
            `UPDATE ledger.payment_attempts SET status = 'NEEDS_REVIEW', closed_at = now(), journal_entry_id = NULL, confirmed_at = NULL WHERE id = $1`,
            [trade.attemptId],
          );
      } finally {
        await t.owner().query(`ALTER TABLE ledger.payment_attempts ENABLE TRIGGER USER`);
      }
      expect(refused(await refund(trade))).toMatch(/no settled charge/);
    });

    it('is blocked by a hold on the trade', async () => {
      const trade = await fundedTradeWithCharge(t);
      await insertRow(t.app(), 'trade.trade_holds', {
        trade_id: trade.tradeId,
        source: 'RISK',
        reason: 'under review',
        placed_by_actor_type: 'SYSTEM',
      });
      expect(await refund(trade)).toEqual({ outcome: 'HELD', holds: ['RISK'] });
      expect(await balance(ESCROW(trade))).toBe(ITEM);
    });

    it('refuses a refund after the escrow was released another way', async () => {
      // Completed and settled: the release emptied the escrow, so a refund finds nothing to return.
      const trade = await fundedTradeWithCharge(t, { status: 'COMPLETED' });
      const released = await t.db().transaction((tx) => releaseEscrow(tx, deps, { tradeId: trade.tradeId }));
      expect(released.outcome).toBe('SETTLED');
      expect(refused(await refund(trade))).toMatch(/COMPLETED, not FUNDED/);
    });

    it('refuses when the escrow does not hold what the snapshot says', async () => {
      // A balanced posting that took one kobo out of this trade's escrow: the books, not the
      // columns, decide whether the money is there.
      const trade = await fundedTradeWithCharge(t);
      await t.db().transaction((tx) =>
        postJournal(tx, {
          idempotencyKey: `test:${trade.tradeId}:skim`,
          description: 'test: one kobo out of escrow',
          tradeId: trade.tradeId,
          lines: [
            { account: ESCROW(trade), direction: 'DEBIT', amountMinor: 1n },
            { account: POOL, direction: 'CREDIT', amountMinor: 1n },
          ],
        }),
      );
      expect(refused(await refund(trade))).toMatch(/escrow holds/);
    });
  });

  describe('a partial refund (T-080)', () => {
    it('moves item money only from a disputed trade, and retains the fee', async () => {
      const trade = await fundedTradeWithCharge(t, { status: 'DISPUTED' });
      const result = await refund(trade, {
        reason: 'DISPUTE_RESOLUTION',
        scope: { scope: 'PARTIAL', itemAmountMinor: 10_000_000n },
      });
      expect(result.outcome).toBe('REFUNDED');
      expect(await balance(ESCROW(trade))).toBe(ITEM - 10_000_000n);
      expect(await balance(FEE_LIABILITY(trade))).toBe(FEE);
    });

    it('never takes a partial past what escrow still holds', async () => {
      const trade = await fundedTradeWithCharge(t, { status: 'DISPUTED' });
      const part = { scope: 'PARTIAL' as const, itemAmountMinor: ITEM - 1n };
      expect((await refund(trade, { scope: part })).outcome).toBe('REFUNDED');
      expect(refused(await refund(trade, { scope: part }))).toMatch(/less than/);
      expect(await balance(ESCROW(trade))).toBe(1n);
    });
  });
  describe('reading refunds (CR3, SC2, GET /me/refunds)', () => {
    it('shows a trade’s refund to both parties and to nobody else', async () => {
      const trade = await fundedTradeWithCharge(t);
      await refund(trade);
      const asBuyer = await listRefundsForTrade(
        { db: t.db() },
        { userId: trade.buyer, tradeId: trade.tradeId },
      );
      expect(asBuyer.refunds).toEqual([
        expect.objectContaining({
          status: 'REQUESTED',
          amountMinor: (ITEM + FEE).toString(),
          feeAmountMinor: FEE.toString(),
          buyerProtectionFeeTreatment: 'REFUND',
        }),
      ]);
      const asSeller = await listRefundsForTrade(
        { db: t.db() },
        { userId: trade.seller, tradeId: trade.tradeId },
      );
      expect(asSeller.refunds).toHaveLength(1);
      const stranger = await listRefundsForTrade(
        { db: t.db() },
        { userId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a55', tradeId: trade.tradeId },
      ).catch((e: unknown) => e);
      expect(stranger).toBeInstanceOf(ApiError);
      expect((stranger as ApiError).status).toBe(404);
    });

    it('pages a buyer’s refunds, newest first', async () => {
      const first = await fundedTradeWithCharge(t);
      await refund(first);
      const page = await listMyRefunds({ db: t.db() }, { userId: first.buyer, limit: 20 });
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBeNull();
      expect((await listMyRefunds({ db: t.db() }, { userId: first.seller, limit: 20 })).items).toHaveLength(
        0,
      );
    });
  });
});
