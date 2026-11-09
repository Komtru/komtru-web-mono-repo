/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- raw `pg` rows are untyped in assertions */
// T-064's single delivery-signal consumer against the real database: trust weighting (M7 section 6),
// the partner-history exception, replay safety and the two human entry points.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DeliverySignalPayload } from '../../../../src/modules/trades/domain/deliverySignal.js';
import {
  applyDeliverySignal,
  confirmDelivery,
  reportDelivered,
} from '../../../../src/modules/trades/services/deliverySignal.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertRow } from '../support.js';
import { failure, fulfilmentDeps, newWorld, person, statusOf, tradeAt } from './fulfilment-support.js';

describe.runIf(infraEnabled)('delivery signals (T-064)', () => {
  const t = useTestDatabase();
  const world = newWorld();
  const deps = () => fulfilmentDeps(t, world);

  const signal = (
    tradeId: string,
    source: DeliverySignalPayload['source'],
    extra: Partial<DeliverySignalPayload> = {},
  ): DeliverySignalPayload => ({
    tradeId,
    source,
    occurredAt: new Date().toISOString(),
    actorUserId: null,
    reference: null,
    ...extra,
  });

  const parcel = () => ({ kind: 'PARK_PARCEL' as const, id: randomUUID() });
  const pkg = () => ({ kind: 'LOGISTICS_PACKAGE' as const, id: randomUUID() });

  const trade = async (id: string) =>
    (await t.owner().query(`SELECT * FROM trade.trades WHERE id = $1`, [id])).rows[0];
  const signals = async (id: string) =>
    (
      await t
        .owner()
        .query(`SELECT source FROM trade.delivery_signals WHERE trade_id = $1 ORDER BY reported_at, id`, [id])
    ).rows.map((r) => r.source as string);
  const deadlines = async (id: string) =>
    (
      await t
        .owner()
        .query(`SELECT kind, status, due_at FROM trade.trade_deadlines WHERE trade_id = $1`, [id])
    ).rows;

  const hours = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 3_600_000);

  describe('trusted sources', () => {
    it.each([
      ['PARTNER_PORTAL', pkg],
      ['PARK_CUSTODY', parcel],
      ['COURIER_API', pkg],
    ] as const)('%s moves a shipped trade straight to INSPECTION', async (source, reference) => {
      const { tradeId } = await tradeAt(t, 'SHIPPED');
      const outcome = await applyDeliverySignal(deps(), signal(tradeId, source, { reference: reference() }));
      expect(outcome).toMatchObject({ outcome: 'MOVED', from: 'SHIPPED', to: 'INSPECTION' });

      const row = await trade(tradeId);
      expect(row.status).toBe('INSPECTION');
      expect(row.delivery_signalled_at).not.toBeNull();
      expect(row.delivery_confirmed_at).not.toBeNull();
      expect(row.inspection_started_at).not.toBeNull();
      // The inspection window comes from the trade's own snapshot, not from live config.
      expect(hours(row.inspection_started_at, row.inspection_deadline_at)).toBe(72);
      expect(await signals(tradeId)).toEqual([source]);
      const change = (
        await t
          .owner()
          .query(
            `SELECT action, actor_type FROM trade.trade_state_changes WHERE trade_id = $1 AND to_status = 'INSPECTION'`,
            [tradeId],
          )
      ).rows[0];
      expect(change.action).toBe('DELIVERY_SIGNAL');
    });

    it('a buyer confirmation of a shipped trade is as strong', async () => {
      const { tradeId, buyer } = await tradeAt(t, 'SHIPPED');
      const outcome = await applyDeliverySignal(
        deps(),
        signal(tradeId, 'BUYER_CONFIRMATION', { actorUserId: buyer }),
      );
      expect(outcome).toMatchObject({ outcome: 'MOVED', to: 'INSPECTION' });
      const change = (
        await t
          .owner()
          .query(
            `SELECT actor_type, actor_id FROM trade.trade_state_changes WHERE trade_id = $1 AND to_status = 'INSPECTION'`,
            [tradeId],
          )
      ).rows[0];
      expect(change).toEqual({ actor_type: 'BUYER', actor_id: buyer });
    });

    it('opens the inspection deadline and meets the delivery deadline', async () => {
      const { tradeId } = await tradeAt(t, 'SHIPPED');
      const dueAt = new Date(Date.now() + 86_400_000).toISOString();
      await insertRow(t.owner(), 'trade.trade_deadlines', {
        trade_id: tradeId,
        kind: 'DELIVERY',
        due_at: dueAt,
        original_due_at: dueAt,
      });
      await applyDeliverySignal(deps(), signal(tradeId, 'PARTNER_PORTAL', { reference: pkg() }));
      const rows = await deadlines(tradeId);
      expect(rows.find((r) => r.kind === 'DELIVERY')).toMatchObject({ status: 'MET' });
      expect(rows.find((r) => r.kind === 'INSPECTION')).toMatchObject({ status: 'PENDING' });
    });
  });

  describe('the seller self-report', () => {
    it('on its own parks the trade at UNCONFIRMED_DELIVERY and confirms nothing', async () => {
      const { tradeId, seller } = await tradeAt(t, 'SHIPPED');
      const outcome = await applyDeliverySignal(
        deps(),
        signal(tradeId, 'SELLER_SELF_REPORT', { actorUserId: seller }),
      );
      expect(outcome).toMatchObject({ outcome: 'MOVED', to: 'UNCONFIRMED_DELIVERY' });
      const row = await trade(tradeId);
      expect(row.status).toBe('UNCONFIRMED_DELIVERY');
      expect(row.delivery_signalled_at).not.toBeNull();
      expect(row.delivery_confirmed_at).toBeNull();
      expect(row.inspection_started_at).toBeNull();
      const grace = (await deadlines(tradeId)).find((d) => d.kind === 'UNCONFIRMED_DELIVERY_GRACE');
      expect(grace).toMatchObject({ status: 'PENDING' });
      expect(hours(new Date(), grace.due_at)).toBe(48);
    });

    it('is trusted once a partner signal sits in the trade history (the exception)', async () => {
      const { tradeId, seller } = await tradeAt(t, 'SHIPPED');
      await insertRow(t.owner(), 'trade.delivery_signals', { trade_id: tradeId, source: 'PARTNER_PORTAL' });
      const outcome = await applyDeliverySignal(
        deps(),
        signal(tradeId, 'SELLER_SELF_REPORT', { actorUserId: seller }),
      );
      expect(outcome).toMatchObject({ outcome: 'MOVED', to: 'INSPECTION' });
    });

    it('a courier signal that arrived before dispatch was recorded still corroborates it later', async () => {
      const { tradeId, seller } = await tradeAt(t, 'FUNDED');
      const early = await applyDeliverySignal(deps(), signal(tradeId, 'COURIER_API', { reference: pkg() }));
      expect(early).toMatchObject({ outcome: 'RECORDED' });
      expect(await statusOf(t.owner(), tradeId)).toBe('FUNDED');

      await t
        .owner()
        .query(
          `UPDATE trade.trades SET status = 'SHIPPED', status_action = 'BEGIN_CUSTODY', status_actor_type = 'SYSTEM', status_revision = status_revision + 1 WHERE id = $1`,
          [tradeId],
        );
      const outcome = await applyDeliverySignal(
        deps(),
        signal(tradeId, 'SELLER_SELF_REPORT', { actorUserId: seller }),
      );
      expect(outcome).toMatchObject({ outcome: 'MOVED', to: 'INSPECTION' });
    });

    it("a buyer's earlier confirmation is not partner history", async () => {
      const { tradeId, seller } = await tradeAt(t, 'SHIPPED');
      await insertRow(t.owner(), 'trade.delivery_signals', {
        trade_id: tradeId,
        source: 'BUYER_CONFIRMATION',
      });
      const outcome = await applyDeliverySignal(
        deps(),
        signal(tradeId, 'SELLER_SELF_REPORT', { actorUserId: seller }),
      );
      expect(outcome).toMatchObject({ to: 'UNCONFIRMED_DELIVERY' });
    });
  });

  describe('from UNCONFIRMED_DELIVERY', () => {
    const unconfirmed = async () => {
      const fixture = await tradeAt(t, 'SHIPPED');
      await applyDeliverySignal(
        deps(),
        signal(fixture.tradeId, 'SELLER_SELF_REPORT', { actorUserId: fixture.seller }),
      );
      return fixture;
    };

    it('the buyer confirming moves it to INSPECTION and meets the grace deadline', async () => {
      const { tradeId, buyer } = await unconfirmed();
      const outcome = await applyDeliverySignal(
        deps(),
        signal(tradeId, 'BUYER_CONFIRMATION', { actorUserId: buyer }),
      );
      expect(outcome).toMatchObject({ outcome: 'MOVED', from: 'UNCONFIRMED_DELIVERY', to: 'INSPECTION' });
      const row = await trade(tradeId);
      expect(row.delivery_confirmed_at).not.toBeNull();
      expect(row.inspection_deadline_at).not.toBeNull();
      const rows = await deadlines(tradeId);
      expect(rows.find((d) => d.kind === 'UNCONFIRMED_DELIVERY_GRACE')).toMatchObject({ status: 'MET' });
      expect(rows.find((d) => d.kind === 'INSPECTION')).toMatchObject({ status: 'PENDING' });
      const change = (
        await t
          .owner()
          .query(
            `SELECT action FROM trade.trade_state_changes WHERE trade_id = $1 AND to_status = 'INSPECTION'`,
            [tradeId],
          )
      ).rows[0];
      expect(change.action).toBe('CONFIRM_RECEIPT');
    });

    it('a courier signal now is recorded as evidence and moves nothing', async () => {
      const { tradeId } = await unconfirmed();
      const outcome = await applyDeliverySignal(
        deps(),
        signal(tradeId, 'PARTNER_PORTAL', { reference: pkg() }),
      );
      expect(outcome).toMatchObject({ outcome: 'RECORDED' });
      expect(await statusOf(t.owner(), tradeId)).toBe('UNCONFIRMED_DELIVERY');
      expect(await signals(tradeId)).toContain('PARTNER_PORTAL');
    });
  });

  describe('safety', () => {
    it('never throws for a payload it cannot read', async () => {
      for (const bad of [
        null,
        {},
        { tradeId: 'nope', source: 'PARTNER_PORTAL' },
        { ...signal(randomUUID(), 'PARTNER_PORTAL'), source: 'PIGEON' },
      ]) {
        expect(await applyDeliverySignal(deps(), bad)).toEqual({
          outcome: 'REJECTED',
          why: 'INVALID_PAYLOAD',
        });
      }
    });

    it('a self-report recorded before dispatch does not shadow the real one after shipping', async () => {
      const { tradeId, seller } = await tradeAt(t, 'FUNDED');
      const early = await applyDeliverySignal(
        deps(),
        signal(tradeId, 'SELLER_SELF_REPORT', { actorUserId: seller }),
      );
      expect(early).toMatchObject({ outcome: 'RECORDED' });
      await t
        .owner()
        .query(
          `UPDATE trade.trades SET status = 'SHIPPED', status_action = 'BEGIN_CUSTODY', status_actor_type = 'SYSTEM', status_revision = status_revision + 1 WHERE id = $1`,
          [tradeId],
        );
      const real = await applyDeliverySignal(
        deps(),
        signal(tradeId, 'SELLER_SELF_REPORT', { actorUserId: seller }),
      );
      expect(real).toMatchObject({ outcome: 'MOVED', to: 'UNCONFIRMED_DELIVERY' });
      // And only now is a further repeat a duplicate.
      expect(
        await applyDeliverySignal(deps(), signal(tradeId, 'SELLER_SELF_REPORT', { actorUserId: seller })),
      ).toEqual({ outcome: 'DUPLICATE' });
    });

    it('the same holds for a buyer confirmation that arrived early', async () => {
      const { tradeId, buyer } = await tradeAt(t, 'FUNDED');
      expect(
        await applyDeliverySignal(deps(), signal(tradeId, 'BUYER_CONFIRMATION', { actorUserId: buyer })),
      ).toMatchObject({ outcome: 'RECORDED' });
      await t
        .owner()
        .query(
          `UPDATE trade.trades SET status = 'SHIPPED', status_action = 'BEGIN_CUSTODY', status_actor_type = 'SYSTEM', status_revision = status_revision + 1 WHERE id = $1`,
          [tradeId],
        );
      expect(
        await applyDeliverySignal(deps(), signal(tradeId, 'BUYER_CONFIRMATION', { actorUserId: buyer })),
      ).toMatchObject({ outcome: 'MOVED', to: 'INSPECTION' });
    });

    it('is replay-safe: the same courier delivery twice is one signal and one transition', async () => {
      const { tradeId } = await tradeAt(t, 'SHIPPED');
      const payload = signal(tradeId, 'PARTNER_PORTAL', { reference: pkg() });
      expect(await applyDeliverySignal(deps(), payload)).toMatchObject({ outcome: 'MOVED' });
      expect(await applyDeliverySignal(deps(), payload)).toEqual({ outcome: 'DUPLICATE' });
      expect(await signals(tradeId)).toHaveLength(1);
      const { rows } = await t
        .owner()
        .query(`SELECT 1 FROM trade.trade_state_changes WHERE trade_id = $1 AND to_status = 'INSPECTION'`, [
          tradeId,
        ]);
      expect(rows).toHaveLength(1);
    });

    it('is race-safe: two simultaneous deliveries of one trade move it once', async () => {
      const { tradeId } = await tradeAt(t, 'SHIPPED');
      const results = await Promise.all([
        applyDeliverySignal(deps(), signal(tradeId, 'PARTNER_PORTAL', { reference: pkg() })),
        applyDeliverySignal(deps(), signal(tradeId, 'PARK_CUSTODY', { reference: parcel() })),
      ]);
      expect(results.filter((r) => r.outcome === 'MOVED')).toHaveLength(1);
      expect(await statusOf(t.owner(), tradeId)).toBe('INSPECTION');
    });

    it('refuses a buyer confirmation from anyone but the buyer, and writes nothing', async () => {
      const { tradeId } = await tradeAt(t, 'SHIPPED');
      const outcome = await applyDeliverySignal(
        deps(),
        signal(tradeId, 'BUYER_CONFIRMATION', { actorUserId: await person(t) }),
      );
      expect(outcome).toEqual({ outcome: 'REJECTED', why: 'WRONG_ACTOR' });
      expect(await signals(tradeId)).toEqual([]);
      expect(await statusOf(t.owner(), tradeId)).toBe('SHIPPED');
    });

    it('refuses a seller self-report from anyone but the seller', async () => {
      const { tradeId, buyer } = await tradeAt(t, 'SHIPPED');
      const outcome = await applyDeliverySignal(
        deps(),
        signal(tradeId, 'SELLER_SELF_REPORT', { actorUserId: buyer }),
      );
      expect(outcome).toEqual({ outcome: 'REJECTED', why: 'WRONG_ACTOR' });
    });

    it('does not throw for a trade it does not know, so a stale event is not retried forever', async () => {
      expect(
        await applyDeliverySignal(deps(), signal(randomUUID(), 'PARTNER_PORTAL', { reference: pkg() })),
      ).toEqual({
        outcome: 'REJECTED',
        why: 'TRADE_NOT_FOUND',
      });
    });

    it('applies a fact even while the trade is on hold: holds stop the clocks that move money', async () => {
      const { tradeId } = await tradeAt(t, 'SHIPPED');
      await insertRow(t.owner(), 'trade.trade_holds', {
        trade_id: tradeId,
        source: 'PARK_EXCEPTION',
        reason: 'seal damaged',
        placed_by_actor_type: 'SYSTEM',
      });
      const outcome = await applyDeliverySignal(
        deps(),
        signal(tradeId, 'PARK_CUSTODY', { reference: parcel() }),
      );
      expect(outcome).toMatchObject({ outcome: 'MOVED', to: 'INSPECTION' });
    });

    it('records evidence and leaves a disputed trade alone', async () => {
      const { tradeId } = await tradeAt(t, 'DISPUTED');
      const outcome = await applyDeliverySignal(
        deps(),
        signal(tradeId, 'PARTNER_PORTAL', { reference: pkg() }),
      );
      expect(outcome).toMatchObject({ outcome: 'RECORDED' });
      expect(await statusOf(t.owner(), tradeId)).toBe('DISPUTED');
    });

    it('logs every applied signal on the trade timeline', async () => {
      const { tradeId } = await tradeAt(t, 'SHIPPED');
      await applyDeliverySignal(deps(), signal(tradeId, 'PARTNER_PORTAL', { reference: pkg() }));
      const { rows } = await t
        .owner()
        .query(
          `SELECT metadata FROM trade.trade_activity WHERE trade_id = $1 AND type = 'DELIVERY_SIGNAL_RECORDED'`,
          [tradeId],
        );
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata).toMatchObject({ source: 'PARTNER_PORTAL', trusted: true, outcome: 'MOVED' });
    });
  });

  describe('the two human entry points', () => {
    it('the buyer confirms receipt of a shipped trade', async () => {
      const { tradeId, buyer } = await tradeAt(t, 'SHIPPED');
      const view = await confirmDelivery(deps(), { userId: buyer, tradeId });
      expect(view.status).toBe('INSPECTION');
      // A double tap returns the trade as it stands.
      expect((await confirmDelivery(deps(), { userId: buyer, tradeId })).status).toBe('INSPECTION');
      expect(await signals(tradeId)).toEqual(['BUYER_CONFIRMATION']);
    });

    it('only the buyer may confirm; only after dispatch', async () => {
      const shipped = await tradeAt(t, 'SHIPPED');
      expect(
        await failure(confirmDelivery(deps(), { userId: shipped.seller, tradeId: shipped.tradeId })),
      ).toMatchObject({
        status: 403,
      });
      const funded = await tradeAt(t, 'FUNDED');
      expect(
        await failure(confirmDelivery(deps(), { userId: funded.buyer, tradeId: funded.tradeId })),
      ).toMatchObject({
        status: 409,
        code: 'INVALID_TRANSITION',
      });
      expect(await signals(funded.tradeId)).toEqual([]);
    });

    it('the seller reports delivered, and the buyer is left to confirm or let the grace run', async () => {
      const { tradeId, seller } = await tradeAt(t, 'SHIPPED');
      const view = await reportDelivered(deps(), { userId: seller, tradeId });
      expect(view.status).toBe('UNCONFIRMED_DELIVERY');
      expect((await reportDelivered(deps(), { userId: seller, tradeId })).status).toBe(
        'UNCONFIRMED_DELIVERY',
      );
      expect(await signals(tradeId)).toEqual(['SELLER_SELF_REPORT']);
    });

    it('only the seller may report, and only on a shipped trade', async () => {
      const shipped = await tradeAt(t, 'SHIPPED');
      expect(
        await failure(reportDelivered(deps(), { userId: shipped.buyer, tradeId: shipped.tradeId })),
      ).toMatchObject({
        status: 403,
      });
      const funded = await tradeAt(t, 'FUNDED');
      expect(
        await failure(reportDelivered(deps(), { userId: funded.seller, tradeId: funded.tradeId })),
      ).toMatchObject({
        status: 409,
      });
    });
  });
});
