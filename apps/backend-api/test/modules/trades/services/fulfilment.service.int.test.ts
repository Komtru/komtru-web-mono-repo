/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- raw `pg` rows are untyped in assertions */
// T-064 ship step against the real database: the dispatch guard (X1), the options the server
// computes (X2, design 7.8) and the self-arranged branch. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  getShipOptions,
  shipSelfArranged,
} from '../../../../src/modules/trades/services/fulfilment.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertRow } from '../support.js';
import {
  failure,
  fulfilmentDeps,
  newWorld,
  outboxOf,
  person,
  statusOf,
  tradeAt,
} from './fulfilment-support.js';

describe.runIf(infraEnabled)('ship step (T-064)', () => {
  const t = useTestDatabase();
  const world = newWorld();
  const deps = () => fulfilmentDeps(t, world);

  const receipt = (uploader: string, contentType = 'image/jpeg') => {
    const id = randomUUID();
    world.files.set(id, {
      contentType,
      uploaderUserId: uploader,
      visibility: 'PRIVATE_CASE',
      grantedUserIds: [],
    });
    return id;
  };

  const ship = (trade: { tradeId: string; seller: string }, overrides: Record<string, unknown> = {}) =>
    shipSelfArranged(deps(), {
      userId: trade.seller,
      tradeId: trade.tradeId,
      shipment: {
        waybillNumber: 'WB-123456',
        receiptFileId: receipt(trade.seller),
        driverPhone: '+2348031234567',
        vehiclePlate: 'ABC-123 DE',
        ...overrides,
      },
    });

  const [LAGOS, JOS, YOLA] = [randomUUID(), randomUUID(), randomUUID()];
  world.cityNames.set(LAGOS, 'Ikeja').set(JOS, 'Jos').set(YOLA, 'Yola');

  describe('the dispatch guard (X1)', () => {
    it.each(['PENDING_PAYMENT', 'AWAITING_ACCEPTANCE'])(
      'locks every shipping endpoint in %s',
      async (status) => {
        const trade = await tradeAt(t, status);
        for (const call of [
          () => getShipOptions(deps(), { userId: trade.seller, tradeId: trade.tradeId }),
          () => ship(trade),
        ]) {
          const error = await failure(call());
          expect(error).toMatchObject({
            status: 409,
            code: 'INVALID_TRANSITION',
            extensions: { reason: 'DISPATCH_LOCKED' },
          });
        }
        expect(await statusOf(t.owner(), trade.tradeId)).toBe(status);
      },
    );

    it('is a plain invalid transition once shipped, and nothing is written', async () => {
      const trade = await tradeAt(t, 'SHIPPED');
      const error = await failure(ship(trade));
      expect(error).toMatchObject({ status: 409, code: 'INVALID_TRANSITION' });
      expect(error.extensions).toMatchObject({ reason: 'NOT_FUNDED_OR_ALREADY_SHIPPED' });
      const { rows } = await t.owner().query(`SELECT 1 FROM trade.self_arranged_shipments`);
      expect(rows).toHaveLength(0);
    });

    it('refuses to ship into a refund in flight: the delivery deadline has elapsed', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const elapsedAt = new Date(Date.now() - 1000).toISOString();
      await insertRow(t.owner(), 'trade.trade_deadlines', {
        trade_id: trade.tradeId,
        kind: 'DELIVERY',
        status: 'ELAPSED',
        due_at: elapsedAt,
        original_due_at: elapsedAt,
        resolved_at: new Date().toISOString(),
      });
      const error = await failure(ship(trade));
      expect(error).toMatchObject({
        status: 409,
        code: 'CONFLICT',
        extensions: { reason: 'DELIVERY_OVERDUE' },
      });
      expect(await statusOf(t.owner(), trade.tradeId)).toBe('FUNDED');
    });

    it('is only for the seller; a stranger sees nothing', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      expect(
        await failure(getShipOptions(deps(), { userId: trade.buyer, tradeId: trade.tradeId })),
      ).toMatchObject({
        status: 403,
      });
      expect(
        await failure(getShipOptions(deps(), { userId: await person(t), tradeId: trade.tradeId })),
      ).toMatchObject({ status: 404 });
    });
  });

  describe('options computed by the server', () => {
    it('pins Park first, lists enabled companies, and keeps self-arranged last', async () => {
      world.companies = [
        { id: 'c-park', name: 'Park', isDefault: true },
        { id: 'c-gig', name: 'GIG Logistics', isDefault: false },
      ];
      world.serviceable = new Set([LAGOS, JOS]);
      const trade = await tradeAt(t, 'FUNDED', { deliveryCity: LAGOS, shipsFromCity: JOS });
      const result = await getShipOptions(deps(), { userId: trade.seller, tradeId: trade.tradeId });
      expect(result.options.map((o) => o.kind)).toEqual(['PARK', 'COMPANY', 'SELF_ARRANGED']);
      expect(result.options[0]).toMatchObject({ available: true, reason: null });
      expect(result.options[1]).toMatchObject({ companyId: 'c-gig', name: 'GIG Logistics' });
      expect(result.tradeCode).toMatch(/^KMT-/);
    });

    it('returns the reason when a city has no live hub, naming the right side', async () => {
      world.companies = [];
      world.serviceable = new Set([JOS]);
      const trade = await tradeAt(t, 'FUNDED', { deliveryCity: YOLA, shipsFromCity: JOS });
      const [park, self] = (await getShipOptions(deps(), { userId: trade.seller, tradeId: trade.tradeId }))
        .options;
      expect(park).toMatchObject({
        kind: 'PARK',
        available: false,
        reason: {
          code: 'PARK_NOT_AVAILABLE_IN_CITY',
          side: 'DELIVERY',
          message: "Park isn't available in Yola yet",
          cities: [{ side: 'DELIVERY', cityId: YOLA, name: 'Yola' }],
        },
      });
      expect(self).toMatchObject({ kind: 'SELF_ARRANGED', available: true });
    });

    it('needs the ships-from city to be serviceable too', async () => {
      world.serviceable = new Set([YOLA]);
      const trade = await tradeAt(t, 'FUNDED', { deliveryCity: YOLA, shipsFromCity: JOS });
      const [park] = (await getShipOptions(deps(), { userId: trade.seller, tradeId: trade.tradeId })).options;
      expect(park).toMatchObject({ available: false, reason: { side: 'SHIPS_FROM' } });
    });
  });

  describe('self-arranged shipping (X2)', () => {
    it('records the evidence, moves the trade to SHIPPED and says who did it', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const view = await ship(trade);
      expect(view).toMatchObject({ status: 'SHIPPED', yourRole: 'SELLER' });
      expect(view.shipment).toMatchObject({
        method: 'SELF_ARRANGED',
        waybillNumber: 'WB-123456',
        driverPhone: '+2348031234567',
        vehiclePlate: 'ABC-123 DE',
      });

      const { rows } = await t
        .owner()
        .query(`SELECT * FROM trade.self_arranged_shipments WHERE trade_id = $1`, [trade.tradeId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].shipped_by_user_id).toBe(trade.seller);

      const change = (
        await t
          .owner()
          .query(
            `SELECT action, actor_type, actor_id FROM trade.trade_state_changes WHERE trade_id = $1 AND to_status = 'SHIPPED'`,
            [trade.tradeId],
          )
      ).rows[0];
      expect(change).toEqual({ action: 'BEGIN_CUSTODY', actor_type: 'SELLER', actor_id: trade.seller });
      const shippedAt = (
        await t.owner().query(`SELECT shipped_at FROM trade.trades WHERE id = $1`, [trade.tradeId])
      ).rows[0];
      expect(shippedAt.shipped_at).not.toBeNull();
      expect(await outboxOf(t.owner(), trade.tradeId, 'trades.trade.state_changed')).toEqual(
        expect.arrayContaining([expect.objectContaining({ action: 'BEGIN_CUSTODY', to: 'SHIPPED' })]),
      );
    });

    it('clears the awaiting-shipment substate when custody begins', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      await t
        .owner()
        .query(`UPDATE trade.trades SET fulfilment_substate = 'AWAITING_SHIPMENT' WHERE id = $1`, [
          trade.tradeId,
        ]);
      await ship(trade);
      const { rows } = await t
        .owner()
        .query(`SELECT fulfilment_substate FROM trade.trades WHERE id = $1`, [trade.tradeId]);
      expect(rows[0].fulfilment_substate).toBeNull();
    });

    it('is idempotent for the same seller replaying the same waybill', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const receiptFileId = receipt(trade.seller);
      const first = await ship(trade, { receiptFileId });
      const again = await ship(trade, { receiptFileId });
      expect(again.status).toBe('SHIPPED');
      expect(again.shipment).toEqual(first.shipment);
      const { rows } = await t
        .owner()
        .query(`SELECT 1 FROM trade.trade_state_changes WHERE trade_id = $1 AND to_status = 'SHIPPED'`, [
          trade.tradeId,
        ]);
      expect(rows).toHaveLength(1);
    });

    it('two simultaneous requests ship once', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const receiptFileId = receipt(trade.seller);
      const results = await Promise.allSettled([
        ship(trade, { receiptFileId }),
        ship(trade, { receiptFileId }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
      const { rows } = await t
        .owner()
        .query(`SELECT 1 FROM trade.self_arranged_shipments WHERE trade_id = $1`, [trade.tradeId]);
      expect(rows).toHaveLength(1);
    });

    it('is for the seller only', async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const error = await failure(
        shipSelfArranged(deps(), {
          userId: trade.buyer,
          tradeId: trade.tradeId,
          shipment: {
            waybillNumber: 'WB-1',
            receiptFileId: receipt(trade.buyer),
            driverPhone: '+2348031234567',
            vehiclePlate: 'ABC123',
          },
        }),
      );
      expect(error).toMatchObject({ status: 403 });
      expect(await statusOf(t.owner(), trade.tradeId)).toBe('FUNDED');
    });

    it("refuses a receipt that is not the seller's own finished image", async () => {
      const trade = await tradeAt(t, 'FUNDED');
      const notMine = receipt(trade.buyer);
      const pdf = receipt(trade.seller, 'application/pdf');
      for (const receiptFileId of [notMine, pdf, randomUUID()]) {
        const error = await failure(ship(trade, { receiptFileId }));
        expect(error).toMatchObject({ status: 422, code: 'VALIDATION_FAILED' });
        expect(error.fieldErrors?.[0]?.path).toBe('receiptFileId');
      }
      expect(await statusOf(t.owner(), trade.tradeId)).toBe('FUNDED');
    });

    it('refuses a receipt already used as evidence on another trade', async () => {
      const first = await tradeAt(t, 'FUNDED');
      const receiptFileId = receipt(first.seller);
      await ship(first, { receiptFileId });
      const second = await tradeAt(t, 'FUNDED');
      world.files.get(receiptFileId)!.uploaderUserId = second.seller;
      expect(await failure(ship(second, { receiptFileId }))).toMatchObject({ status: 422 });
    });
  });
});
