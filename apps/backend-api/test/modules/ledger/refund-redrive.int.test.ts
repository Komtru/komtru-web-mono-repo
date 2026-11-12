// The F-030 review's must-fix: a refund request the ledger refused because of a hold is consumed with
// the event, so nothing would ever ask again. The sweep's re-drive decides it again once the hold is
// gone — and never refunds a trade twice. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/platform/logger.js';
import { decideRefund } from '../../../src/modules/ledger/index.js';
import {
  redriveRefundRequests,
  STRANDED_REFUND_REQUEST_MS,
} from '../../../src/modules/ledger/jobs/refund.job.js';
import {
  cancelAsSeller,
  refundTrade,
  requestCancellation,
  respondToCancellation,
} from '../../../src/modules/trades/services/cancellation.service.js';
import { infraEnabled, testRedisEnv, testRedisUrl } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { fulfilmentDeps, newWorld } from '../trades/services/fulfilment-support.js';
import { insertRow } from '../trades/support.js';
import { fundedTradeWithCharge, outboxOf, type FundedTrade } from './refund-support.js';

const logger = createLogger(
  loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
    REDIS_URL: testRedisUrl(),
    ...testRedisEnv(),
  }),
);

/** Past the re-drive's threshold, so a request made "now" counts as stranded. */
const later = () => new Date(Date.now() + STRANDED_REFUND_REQUEST_MS + 60_000);

describe.runIf(infraEnabled)('re-driving a refused refund request (T-075, T-066)', () => {
  const t = useTestDatabase();
  const world = newWorld();
  const deps = () => fulfilmentDeps(t, world);

  const refundsOf = async (trade: FundedTrade) =>
    (
      await t
        .owner()
        .query<{ id: string; reason: string; status: string }>(
          `SELECT id, reason, status FROM ledger.refunds WHERE trade_id = $1`,
          [trade.tradeId],
        )
    ).rows;
  const hold = (tradeId: string) =>
    insertRow(t.owner(), 'trade.trade_holds', {
      trade_id: tradeId,
      source: 'RISK',
      reason: 'under review',
      placed_by_actor_type: 'SYSTEM',
    });
  const lift = (holdId: string) =>
    t.owner().query('UPDATE trade.trade_holds SET released_at = now() WHERE id = $1', [holdId]);
  /** What the bus does with the request: one decision, whatever it says. */
  const deliverRequest = (trade: FundedTrade, reason: string) =>
    t.db().transaction((tx) => decideRefund(tx, { logger }, { tradeId: trade.tradeId, reason }));
  const redrive = (now = later()) => redriveRefundRequests({ db: t.db(), logger, now });

  it('decides a seller’s cancellation again once the hold placed before its decision is lifted', async () => {
    const trade = await fundedTradeWithCharge(t);
    await cancelAsSeller(deps(), { userId: trade.seller, tradeId: trade.tradeId, reason: 'OUT_OF_STOCK' });
    // A hold lands after the seller cancelled and before the bus delivered the request.
    const holdId = await hold(trade.tradeId);
    expect((await deliverRequest(trade, 'SELLER_CANNOT_FULFIL')).outcome).toBe('HELD');

    // Still held: the sweep leaves it.
    expect(await redrive()).toEqual({ redriven: 0, refunded: 0 });
    expect(await refundsOf(trade)).toHaveLength(0);

    await lift(holdId);
    expect(await redrive()).toEqual({ redriven: 1, refunded: 1 });
    expect(await refundsOf(trade)).toEqual([
      expect.objectContaining({ reason: 'SELLER_CANNOT_FULFIL', status: 'REQUESTED' }),
    ]);
    const announced = (await outboxOf(t, 'ledger.payment.escrow_refunded')).filter(
      (e) => e.tradeId === trade.tradeId,
    );
    expect(announced).toHaveLength(1);

    // Until the trade hears back it is still FUNDED; asking again refunds nothing more.
    expect(await redrive()).toEqual({ redriven: 1, refunded: 0 });
    expect(await refundsOf(trade)).toHaveLength(1);
  });

  it('gives an agreed cancellation its own reason', async () => {
    const trade = await fundedTradeWithCharge(t);
    const request = await requestCancellation(deps(), {
      userId: trade.buyer,
      tradeId: trade.tradeId,
      reason: 'CHANGED_MIND',
    });
    await respondToCancellation(deps(), {
      userId: trade.seller,
      tradeId: trade.tradeId,
      requestId: request.id,
      decision: 'APPROVE',
    });
    const holdId = await hold(trade.tradeId);
    expect((await deliverRequest(trade, 'MUTUAL_AGREEMENT')).outcome).toBe('HELD');
    await lift(holdId);

    expect((await redrive()).refunded).toBe(1);
    expect(await refundsOf(trade)).toEqual([expect.objectContaining({ reason: 'MUTUAL_AGREEMENT' })]);
  });

  it('re-drives an overdue delivery’s refund too', async () => {
    const trade = await fundedTradeWithCharge(t);
    const past = new Date(Date.now() - 60_000);
    await insertRow(t.owner(), 'trade.trade_deadlines', {
      trade_id: trade.tradeId,
      kind: 'DELIVERY',
      status: 'ELAPSED',
      due_at: past,
      original_due_at: past,
      resolved_at: past,
      reason: 'Delivery deadline passed',
    });

    expect((await redrive()).refunded).toBe(1);
    expect(await refundsOf(trade)).toEqual([expect.objectContaining({ reason: 'DELIVERY_OVERDUE' })]);
  });

  it('leaves a request the ledger may still be answering, and trades that never asked', async () => {
    const asked = await fundedTradeWithCharge(t);
    await cancelAsSeller(deps(), { userId: asked.seller, tradeId: asked.tradeId, reason: 'OUT_OF_STOCK' });
    const untouched = await fundedTradeWithCharge(t);

    // Within the threshold the event's own decision is presumed on its way.
    expect(await redrive(new Date())).toEqual({ redriven: 0, refunded: 0 });
    expect((await redrive()).redriven).toBe(1);
    expect(await refundsOf(untouched)).toHaveLength(0);
  });

  it('never re-drives a trade that has moved on', async () => {
    const trade = await fundedTradeWithCharge(t);
    await cancelAsSeller(deps(), { userId: trade.seller, tradeId: trade.tradeId, reason: 'OUT_OF_STOCK' });
    const decision = await deliverRequest(trade, 'SELLER_CANNOT_FULFIL');
    if (decision.outcome !== 'REFUNDED') throw new Error(decision.outcome);
    // The ledger's answer reaches the trade: FUNDED -> CANCELLED_REFUNDED.
    await t.db().transaction((tx) =>
      refundTrade(tx, {
        tradeId: trade.tradeId,
        refundId: decision.refundId,
        journalEntryId: decision.journalEntryId,
        reason: 'SELLER_CANNOT_FULFIL',
        scope: 'FULL',
      }),
    );

    expect(await redrive()).toEqual({ redriven: 0, refunded: 0 });
    expect(await refundsOf(trade)).toHaveLength(1);
  });
});
