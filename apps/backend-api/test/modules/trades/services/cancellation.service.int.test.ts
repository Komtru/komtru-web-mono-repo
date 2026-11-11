/* eslint-disable @typescript-eslint/no-unsafe-member-access -- raw `pg` rows are untyped in assertions */
// T-066 against the real database: CR1 the buyer asks, CR2 the seller answers, SC1 the seller cannot
// fulfil, and the ledger's answer closing the trade. The refund itself is the ledger's (T-075); the last
// block drives the two together through the events each publishes. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../../src/config/env.js';
import { createLogger } from '../../../../src/platform/logger.js';
import { accountBalance, decideRefund } from '../../../../src/modules/ledger/index.js';
import {
  cancelAsSeller,
  getCancellation,
  lapsePendingCancellation,
  refundTrade,
  requestCancellation,
  respondToCancellation,
} from '../../../../src/modules/trades/services/cancellation.service.js';
import { assertDispatchOpen, loadTrade } from '../../../../src/modules/trades/index.js';
import { infraEnabled, testRedisEnv, testRedisUrl } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { fundedTradeWithCharge } from '../../ledger/refund-support.js';
import { sqlState } from '../../ledger/support.js';
import { insertRow } from '../support.js';
import { failure, fulfilmentDeps, newWorld, outboxOf, statusOf, tradeAt } from './fulfilment-support.js';

const logger = createLogger(
  loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
    REDIS_URL: testRedisUrl(),
    ...testRedisEnv(),
  }),
);

describe.runIf(infraEnabled)('cancelling a funded trade (T-066)', () => {
  const t = useTestDatabase();
  const world = newWorld();
  const deps = () => fulfilmentDeps(t, world);

  const ask = (
    trade: { tradeId: string; buyer: string },
    reason: 'CHANGED_MIND' | 'FOUND_CHEAPER' = 'CHANGED_MIND',
  ) => requestCancellation(deps(), { userId: trade.buyer, tradeId: trade.tradeId, reason });
  const answer = (
    trade: { tradeId: string; seller: string },
    requestId: string,
    decision: 'APPROVE' | 'DECLINE',
  ) => respondToCancellation(deps(), { userId: trade.seller, tradeId: trade.tradeId, requestId, decision });
  const refundRequests = (tradeId: string) => outboxOf(t.owner(), tradeId, 'trades.refund.requested');
  const hold = (tradeId: string) =>
    insertRow(t.owner(), 'trade.trade_holds', {
      trade_id: tradeId,
      source: 'RISK',
      reason: 'under review',
      placed_by_actor_type: 'SYSTEM',
    });

  describe('CR1: the buyer asks', () => {
    it('records a pending request and tells the seller', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const request = await ask(trade);
      expect(request).toMatchObject({ requestedByRole: 'BUYER', reason: 'CHANGED_MIND', status: 'PENDING' });
      expect(await outboxOf(t.owner(), trade.tradeId, 'trades.cancellation.requested')).toEqual([
        expect.objectContaining({ requestId: request.id, reason: 'CHANGED_MIND' }),
      ]);
      // Asking moves no money: the trade is still FUNDED and nothing was asked of the ledger.
      expect(await statusOf(t.owner(), trade.tradeId)).toBe('FUNDED');
      expect(await refundRequests(trade.tradeId)).toHaveLength(0);
    });

    it('answers a replay with the same request, and refuses a second one', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const first = await ask(trade);
      expect((await ask(trade)).id).toBe(first.id);
      expect((await failure(ask(trade, 'FOUND_CHEAPER'))).extensions).toMatchObject({
        reason: 'CANCELLATION_ALREADY_PENDING',
      });
    });

    it('is the buyer’s alone, and only before shipment', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const seller = await failure(
        requestCancellation(deps(), { userId: trade.seller, tradeId: trade.tradeId, reason: 'CHANGED_MIND' }),
      );
      expect(seller.status).toBe(403);

      const shipped = await tradeAt(t, 'SHIPPED');
      expect((await failure(ask(shipped))).extensions).toMatchObject({ reason: 'NOT_FUNDED' });
      const unpaid = await tradeAt(t, 'PENDING_PAYMENT');
      expect((await failure(ask(unpaid))).status).toBe(409);
    });

    it('is refused on a held trade', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      await hold(trade.tradeId);
      expect((await failure(ask(trade))).extensions).toMatchObject({ reason: 'TRADE_HELD' });
    });
  });

  describe('CR2: the seller answers', () => {
    it('approving asks the ledger for a full refund, once', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const request = await ask(trade);
      const approved = await answer(trade, request.id, 'APPROVE');
      expect(approved.status).toBe('APPROVED');
      expect((await answer(trade, request.id, 'APPROVE')).status).toBe('APPROVED');

      expect(await refundRequests(trade.tradeId)).toEqual([
        expect.objectContaining({ tradeId: trade.tradeId, reason: 'MUTUAL_AGREEMENT', scope: 'FULL' }),
      ]);
      expect((await failure(answer(trade, request.id, 'DECLINE'))).extensions).toMatchObject({
        reason: 'CANCELLATION_ALREADY_ANSWERED',
      });
    });

    it('closes dispatch once approved, so nothing ships into a refund', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const request = await ask(trade);
      await answer(trade, request.id, 'APPROVE');
      const refused = await failure(
        t.db().transaction(async (tx) => assertDispatchOpen(tx, await loadTrade(tx, trade.tradeId))),
      );
      expect(refused.extensions).toMatchObject({ reason: 'CANCELLATION_APPROVED' });
    });

    it('declining moves no money, and the buyer may not ask again', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const request = await ask(trade);
      expect((await answer(trade, request.id, 'DECLINE')).status).toBe('DECLINED');
      expect(await refundRequests(trade.tradeId)).toHaveLength(0);
      expect((await failure(ask(trade, 'FOUND_CHEAPER'))).extensions).toMatchObject({
        reason: 'CANCELLATION_ALREADY_ANSWERED',
      });
      const view = await getCancellation(deps(), { userId: trade.buyer, tradeId: trade.tradeId });
      expect(view.actions.canRequest).toBe(false);
    });

    it('is the seller’s alone', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const request = await ask(trade);
      const buyer = await failure(
        respondToCancellation(deps(), {
          userId: trade.buyer,
          tradeId: trade.tradeId,
          requestId: request.id,
          decision: 'APPROVE',
        }),
      );
      expect(buyer.status).toBe(403);
    });

    it('cannot approve once a hold is placed', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const request = await ask(trade);
      await hold(trade.tradeId);
      expect((await failure(answer(trade, request.id, 'APPROVE'))).extensions).toMatchObject({
        reason: 'TRADE_HELD',
      });
      expect(await refundRequests(trade.tradeId)).toHaveLength(0);
    });
  });

  describe('SC1: the seller cannot fulfil', () => {
    it('asks for a full refund at once, overtaking a buyer request still waiting', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const pending = await ask(trade);
      const own = await cancelAsSeller(deps(), {
        userId: trade.seller,
        tradeId: trade.tradeId,
        reason: 'OUT_OF_STOCK',
      });
      expect(own).toMatchObject({ requestedByRole: 'SELLER', reason: 'OUT_OF_STOCK', status: 'APPROVED' });
      expect(
        (await t.owner().query(`SELECT status FROM trade.cancellation_requests WHERE id = $1`, [pending.id]))
          .rows[0].status,
      ).toBe('LAPSED');
      // A replay is the same cancellation; it asks the ledger once.
      await cancelAsSeller(deps(), { userId: trade.seller, tradeId: trade.tradeId, reason: 'OUT_OF_STOCK' });
      expect(await refundRequests(trade.tradeId)).toEqual([
        expect.objectContaining({ reason: 'SELLER_CANNOT_FULFIL', scope: 'FULL' }),
      ]);
    });

    it('is the seller’s alone', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const buyer = await failure(
        cancelAsSeller(deps(), { userId: trade.buyer, tradeId: trade.tradeId, reason: 'OUT_OF_STOCK' }),
      );
      expect(buyer.status).toBe(403);
    });

    it('is refused once a refund is already on its way', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      await cancelAsSeller(deps(), { userId: trade.seller, tradeId: trade.tradeId, reason: 'OUT_OF_STOCK' });
      const again = await failure(
        cancelAsSeller(deps(), { userId: trade.seller, tradeId: trade.tradeId, reason: 'WRONG_PRICE' }),
      );
      expect(again.extensions).toMatchObject({ reason: 'REFUND_ALREADY_REQUESTED' });
    });
  });

  describe('the ledger’s answer', () => {
    const refunded = (tradeId: string, scope: 'FULL' | 'PARTIAL' = 'FULL') =>
      t.db().transaction((tx) =>
        refundTrade(tx, {
          tradeId,
          refundId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a33',
          journalEntryId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a44',
          reason: 'SELLER_CANNOT_FULFIL',
          scope,
        }),
      );

    it('closes a funded trade as CANCELLED_REFUNDED, with the reason, once', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      expect(await refunded(trade.tradeId)).toBe('REFUNDED');
      expect(await refunded(trade.tradeId)).toBe('ALREADY_REFUNDED');
      const { rows } = await t
        .owner()
        .query(`SELECT status, cancellation_reason, status_actor_type FROM trade.trades WHERE id = $1`, [
          trade.tradeId,
        ]);
      expect(rows[0]).toMatchObject({
        status: 'CANCELLED_REFUNDED',
        cancellation_reason: 'SELLER_CANNOT_FULFIL',
        status_actor_type: 'LEDGER',
      });
    });

    it('moves nothing for a trade that has moved on, or a partial refund', async () => {
      const shipped = await tradeAt(t, 'SHIPPED');
      expect(await refunded(shipped.tradeId)).toBe('IGNORED');
      const funded = await tradeAt(t, 'FUNDED');
      expect(await refunded(funded.tradeId, 'PARTIAL')).toBe('IGNORED');
      expect(await statusOf(t.owner(), funded.tradeId)).toBe('FUNDED');
    });

    it('lapses a request still waiting when the trade leaves FUNDED', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const request = await ask(trade);
      expect(await t.db().transaction((tx) => lapsePendingCancellation(tx, trade.tradeId))).toBe(1);
      expect((await failure(answer(trade, request.id, 'APPROVE'))).extensions).toMatchObject({
        reason: 'CANCELLATION_LAPSED',
      });
    });
  });

  describe('the database', () => {
    it('never re-answers a request, and keeps each side to its own reasons', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const request = await ask(trade);
      await answer(trade, request.id, 'DECLINE');
      expect(
        await sqlState(
          t
            .app()
            .query(`UPDATE trade.cancellation_requests SET status = 'APPROVED' WHERE id = $1`, [request.id]),
        ),
      ).toBe('KT015');
      expect(
        await sqlState(
          t.app().query(
            `INSERT INTO trade.cancellation_requests (trade_id, requested_by_role, requested_by_user_id, reason)
             VALUES ($1, 'BUYER', $2, 'OUT_OF_STOCK')`,
            [trade.tradeId, trade.buyer],
          ),
        ),
      ).toBe('23514');
    });
  });

  describe('end to end with the ledger (T-075)', () => {
    it('a seller who cannot fulfil leaves the buyer refunded and the trade closed', async () => {
      const trade = await fundedTradeWithCharge(t);
      await cancelAsSeller(deps(), { userId: trade.seller, tradeId: trade.tradeId, reason: 'OUT_OF_STOCK' });

      // What the bus would deliver: the trade's refund request to the ledger, then the ledger's answer back.
      const [asked] = await refundRequests(trade.tradeId);
      const decision = await t
        .db()
        .transaction((tx) =>
          decideRefund(tx, { logger }, { tradeId: trade.tradeId, reason: String(asked?.reason) }),
        );
      expect(decision.outcome).toBe('REFUNDED');
      const [answered] = (
        await t
          .owner()
          .query<{ payload: Record<string, unknown> }>(
            `SELECT payload FROM platform.outbox WHERE event_type = 'ledger.payment.escrow_refunded' AND payload->>'tradeId' = $1`,
            [trade.tradeId],
          )
      ).rows.map((row) => row.payload);
      expect(answered).toBeDefined();
      expect(
        await t.db().transaction((tx) =>
          refundTrade(tx, {
            tradeId: trade.tradeId,
            refundId: String(answered?.refundId),
            journalEntryId: String(answered?.journalEntryId),
            reason: String(answered?.reason),
            scope: 'FULL',
          }),
        ),
      ).toBe('REFUNDED');

      expect(await statusOf(t.owner(), trade.tradeId)).toBe('CANCELLED_REFUNDED');
      expect(
        (await accountBalance(t.db(), { type: 'USER_ESCROW_LIABILITY', tradeId: trade.tradeId }))
          .balanceMinor,
      ).toBe(0n);
      const view = await getCancellation(deps(), { userId: trade.buyer, tradeId: trade.tradeId });
      expect(view).toMatchObject({ tradeStatus: 'CANCELLED_REFUNDED', refundRequested: true });
    });
  });
});
