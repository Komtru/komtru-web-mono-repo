/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- raw `pg` rows are untyped in assertions */
// T-065's clocks against the real database: the inspection window elapsing (AR1), the unconfirmed-
// delivery grace (M7 section 6) and the ledger's answer (SETTLED). The sweeps are the job bodies, so
// idempotency, hold handling and the dispute seam are tested on them directly.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  confirmAndRelease,
  requestInspectionExtension,
  respondToInspectionExtension,
} from '../../../../src/modules/trades/services/inspection.service.js';
import {
  settleTrade,
  sweepGraceDeadlines,
  sweepInspectionDeadlines,
} from '../../../../src/modules/trades/services/inspectionDeadline.service.js';
import {
  applyDeliverySignal,
  confirmDelivery,
} from '../../../../src/modules/trades/services/deliverySignal.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { fulfilmentDeps, newWorld, outboxOf, statusOf, tradeAt } from './fulfilment-support.js';
import {
  deadlineRow,
  H,
  inspectionDeps,
  placeHold,
  releaseHold,
  stateChanges,
  trade,
  tradeRow,
} from './inspection-support.js';

describe.runIf(infraEnabled)('inspection and grace deadlines (T-065)', () => {
  const t = useTestDatabase();
  const world = newWorld();
  const seam = { dispute: false };
  const deps = () => inspectionDeps(t, world, seam);
  const reset = () => {
    world.clock.now = new Date();
    seam.dispute = false;
  };

  describe('AR1: the inspection window elapsing', () => {
    it('completes the trade automatically, without an acknowledgement, and says how', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', -1);
      expect(await sweepInspectionDeadlines(deps())).toEqual({ examined: 1, COMPLETED: 1 });

      expect(await statusOf(t.owner(), f.tradeId)).toBe('COMPLETED');
      const [change] = await stateChanges(t, f.tradeId, 'INSPECTION_ELAPSED');
      expect(change).toMatchObject({
        from_status: 'INSPECTION',
        to_status: 'COMPLETED',
        actor_type: 'SYSTEM',
      });
      expect((await deadlineRow(t, f.deadlineId)).status).toBe('ELAPSED');
      expect((await tradeRow(t, f.tradeId)).completed_at).not.toBeNull();
      const { rows } = await t
        .owner()
        .query(`SELECT 1 FROM trade.inspection_acknowledgements WHERE trade_id = $1`, [f.tradeId]);
      expect(rows).toHaveLength(0);
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.trade.completed')).toEqual([
        expect.objectContaining({ via: 'INSPECTION_ELAPSED' }),
      ]);
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.trade.state_changed')).toContainEqual(
        expect.objectContaining({ to: 'COMPLETED', action: 'INSPECTION_ELAPSED' }),
      );
    });

    it('leaves a window that has not elapsed alone', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 2);
      expect(await sweepInspectionDeadlines(deps())).toEqual({ examined: 0 });
      expect(await statusOf(t.owner(), f.tradeId)).toBe('INSPECTION');
    });

    it('does nothing while a hold is active, and completes once it is released', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', -1);
      const hold = await placeHold(t, f.tradeId);
      expect(await sweepInspectionDeadlines(deps())).toEqual({ examined: 1, WAIT: 1 });
      expect(await statusOf(t.owner(), f.tradeId)).toBe('INSPECTION');
      expect((await deadlineRow(t, f.deadlineId)).status).toBe('PENDING');
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.trade.completed')).toHaveLength(0);
      expect(await stateChanges(t, f.tradeId, 'INSPECTION_ELAPSED')).toHaveLength(0);

      await releaseHold(t, hold);
      expect(await sweepInspectionDeadlines(deps())).toEqual({ examined: 1, COMPLETED: 1 });
      expect(await statusOf(t.owner(), f.tradeId)).toBe('COMPLETED');
    });

    it('does nothing while a dispute exists (the T-080 seam), and completes once it does not', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', -1);
      seam.dispute = true;
      expect(await sweepInspectionDeadlines(deps())).toEqual({ examined: 1, WAIT: 1 });
      expect(await statusOf(t.owner(), f.tradeId)).toBe('INSPECTION');
      seam.dispute = false;
      expect(await sweepInspectionDeadlines(deps())).toEqual({ examined: 1, COMPLETED: 1 });
    });

    it('is idempotent: running the job again, or twice at once, completes the trade once', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', -1);
      const results = await Promise.all([sweepInspectionDeadlines(deps()), sweepInspectionDeadlines(deps())]);
      expect(results.reduce((n, r) => n + (r.COMPLETED ?? 0), 0)).toBe(1);
      expect(await sweepInspectionDeadlines(deps())).toEqual({ examined: 0 });
      expect(await stateChanges(t, f.tradeId, 'INSPECTION_ELAPSED')).toHaveLength(1);
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.trade.completed')).toHaveLength(1);
      expect(
        (await outboxOf(t.owner(), f.tradeId, 'trades.trade.state_changed')).filter(
          (p) => p.to === 'COMPLETED',
        ),
      ).toHaveLength(1);
    });

    it('does not race a buyer who confirms at the same moment: one route wins, one completion', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', -1);
      const outcomes = await Promise.allSettled([
        confirmAndRelease(deps(), { userId: f.buyer, tradeId: f.tradeId }),
        sweepInspectionDeadlines(deps()),
      ]);
      expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(0);
      expect(await statusOf(t.owner(), f.tradeId)).toBe('COMPLETED');
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.trade.completed')).toHaveLength(1);
      const complete = await stateChanges(t, f.tradeId, 'COMPLETE');
      const elapsed = await stateChanges(t, f.tradeId, 'INSPECTION_ELAPSED');
      expect(complete.length + elapsed.length).toBe(1);
    });

    it('closes the row as met for a trade already completed, without touching it', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', -1);
      await t
        .owner()
        .query(
          `UPDATE trade.trades SET status = 'COMPLETED', status_action = 'COMPLETE', status_revision = status_revision + 1 WHERE id = $1`,
          [f.tradeId],
        );
      expect(await sweepInspectionDeadlines(deps())).toEqual({ examined: 1, MET: 1 });
      expect((await deadlineRow(t, f.deadlineId)).status).toBe('MET');
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.trade.completed')).toHaveLength(0);
    });

    it('closes the row as cancelled for a disputed trade and moves nothing', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', -1);
      await t
        .owner()
        .query(
          `UPDATE trade.trades SET status = 'DISPUTED', status_action = 'DISPUTE', status_revision = status_revision + 1 WHERE id = $1`,
          [f.tradeId],
        );
      expect(await sweepInspectionDeadlines(deps())).toEqual({ examined: 1, CANCELLED: 1 });
      expect(await statusOf(t.owner(), f.tradeId)).toBe('DISPUTED');
    });

    it('lapses a request the seller never answered, and completes on the original date', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 1);
      const request = await requestInspectionExtension(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        extraHours: 24,
      });
      world.clock.now = new Date(Date.now() + 2 * H);
      expect(await sweepInspectionDeadlines(deps())).toEqual({ examined: 1, COMPLETED: 1 });
      const { rows } = await t
        .owner()
        .query(`SELECT status FROM trade.inspection_extension_requests WHERE id = $1`, [request.id]);
      expect(rows).toEqual([{ status: 'LAPSED' }]);
    });

    it('waits for an extension the seller accepted', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 1);
      const request = await requestInspectionExtension(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        extraHours: 24,
      });
      await respondToInspectionExtension(deps(), {
        userId: f.seller,
        tradeId: f.tradeId,
        requestId: request.id,
        decision: 'ACCEPT',
      });
      world.clock.now = new Date(Date.now() + 2 * H);
      expect(await sweepInspectionDeadlines(deps())).toEqual({ examined: 0 });
      expect(await statusOf(t.owner(), f.tradeId)).toBe('INSPECTION');
      world.clock.now = new Date(Date.now() + 26 * H);
      expect(await sweepInspectionDeadlines(deps())).toEqual({ examined: 1, COMPLETED: 1 });
    });
  });

  describe('M7 section 6: the grace period elapsing', () => {
    it('converts the delivery and starts the inspection window from the snapshot', async () => {
      reset();
      const f = await trade(t, 'UNCONFIRMED_DELIVERY', -1);
      expect(await sweepGraceDeadlines(deps())).toEqual({ examined: 1, CONVERTED: 1 });

      const row = await tradeRow(t, f.tradeId);
      expect(row.status).toBe('INSPECTION');
      expect(row.status_reason).toBe('GRACE_PERIOD_ELAPSED');
      expect(row.delivery_confirmed_at).not.toBeNull();
      expect(row.inspection_started_at).not.toBeNull();
      const window = new Date(row.inspection_deadline_at).getTime() - world.clock.now.getTime();
      expect(Math.abs(window - row.inspection_window_hours * H)).toBeLessThan(5_000);
      const [change] = await stateChanges(t, f.tradeId, 'GRACE_ELAPSED');
      expect(change).toMatchObject({
        from_status: 'UNCONFIRMED_DELIVERY',
        to_status: 'INSPECTION',
        actor_type: 'SYSTEM',
      });
      expect((await deadlineRow(t, f.deadlineId)).status).toBe('ELAPSED');
      const { rows } = await t
        .owner()
        .query(`SELECT status FROM trade.trade_deadlines WHERE trade_id = $1 AND kind = 'INSPECTION'`, [
          f.tradeId,
        ]);
      expect(rows).toEqual([{ status: 'PENDING' }]);
    });

    it('waits on a hold or a dispute, and is idempotent when it does act', async () => {
      reset();
      const f = await trade(t, 'UNCONFIRMED_DELIVERY', -1);
      const hold = await placeHold(t, f.tradeId);
      expect(await sweepGraceDeadlines(deps())).toEqual({ examined: 1, WAIT: 1 });
      await releaseHold(t, hold);
      seam.dispute = true;
      expect(await sweepGraceDeadlines(deps())).toEqual({ examined: 1, WAIT: 1 });
      expect(await statusOf(t.owner(), f.tradeId)).toBe('UNCONFIRMED_DELIVERY');
      seam.dispute = false;

      const results = await Promise.all([sweepGraceDeadlines(deps()), sweepGraceDeadlines(deps())]);
      expect(results.reduce((n, r) => n + (r.CONVERTED ?? 0), 0)).toBe(1);
      expect(await stateChanges(t, f.tradeId, 'GRACE_ELAPSED')).toHaveLength(1);
      const { rows } = await t
        .owner()
        .query(`SELECT 1 FROM trade.trade_deadlines WHERE trade_id = $1 AND kind = 'INSPECTION'`, [
          f.tradeId,
        ]);
      expect(rows).toHaveLength(1);
    });

    it('leaves a trade the buyer already confirmed: the confirmation closes the row', async () => {
      reset();
      const f = await tradeAt(t, 'SHIPPED');
      // Reach UNCONFIRMED_DELIVERY the real way, then let the buyer confirm.
      await applyDeliverySignal(fulfilmentDeps(t, world), {
        tradeId: f.tradeId,
        source: 'SELLER_SELF_REPORT',
        occurredAt: new Date().toISOString(),
        actorUserId: f.seller,
        reference: null,
      });
      expect(await statusOf(t.owner(), f.tradeId)).toBe('UNCONFIRMED_DELIVERY');
      const past = new Date(Date.now() - H).toISOString();
      await t
        .owner()
        .query(
          `UPDATE trade.trade_deadlines SET due_at = $2, original_due_at = $2 WHERE trade_id = $1 AND kind = 'UNCONFIRMED_DELIVERY_GRACE'`,
          [f.tradeId, past],
        );
      await confirmDelivery(fulfilmentDeps(t, world), { userId: f.buyer, tradeId: f.tradeId });
      expect(await statusOf(t.owner(), f.tradeId)).toBe('INSPECTION');
      expect(await sweepGraceDeadlines(deps())).toEqual({ examined: 0 });
      expect(await stateChanges(t, f.tradeId, 'GRACE_ELAPSED')).toHaveLength(0);
    });

    it('goes all the way: grace, inspection window, release and settlement', async () => {
      reset();
      const f = await trade(t, 'UNCONFIRMED_DELIVERY', -1);
      await sweepGraceDeadlines(deps());
      expect(await statusOf(t.owner(), f.tradeId)).toBe('INSPECTION');
      world.clock.now = new Date(Date.now() + 73 * H);
      expect(await sweepInspectionDeadlines(deps())).toEqual({ examined: 1, COMPLETED: 1 });
      expect(await statusOf(t.owner(), f.tradeId)).toBe('COMPLETED');
      const outcome = await t
        .db()
        .transaction((tx) => settleTrade(tx, { tradeId: f.tradeId, journalEntryId: randomUUID() }));
      expect(outcome).toBe('SETTLED');
      expect(await statusOf(t.owner(), f.tradeId)).toBe('SETTLED');
    });
  });

  describe('payment.escrow_released: COMPLETED to SETTLED', () => {
    const settle = (tradeId: string, journalEntryId = randomUUID()) =>
      t.db().transaction((tx) => settleTrade(tx, { tradeId, journalEntryId }));

    it('settles a completed trade as the ledger, once', async () => {
      const f = await tradeAt(t, 'COMPLETED');
      const journal = randomUUID();
      expect(await settle(f.tradeId, journal)).toBe('SETTLED');
      const [change] = await stateChanges(t, f.tradeId, 'SETTLE');
      expect(change).toMatchObject({ from_status: 'COMPLETED', to_status: 'SETTLED', actor_type: 'LEDGER' });
      expect((await tradeRow(t, f.tradeId)).status_context).toMatchObject({ journalEntryId: journal });
      expect((await tradeRow(t, f.tradeId)).settled_at).not.toBeNull();
      // A redelivered event changes nothing.
      expect(await settle(f.tradeId, journal)).toBe('ALREADY_SETTLED');
      expect(await stateChanges(t, f.tradeId, 'SETTLE')).toHaveLength(1);
    });

    it('settles even under a hold: the money has already moved', async () => {
      const f = await tradeAt(t, 'COMPLETED');
      await placeHold(t, f.tradeId);
      expect(await settle(f.tradeId)).toBe('SETTLED');
    });

    it('leaves a trade that is not completed alone, and an unknown one', async () => {
      const inspecting = await tradeAt(t, 'INSPECTION');
      expect(await settle(inspecting.tradeId)).toBe('IGNORED');
      expect(await statusOf(t.owner(), inspecting.tradeId)).toBe('INSPECTION');
      const resolved = await tradeAt(t, 'RESOLVED_RELEASED');
      expect(await settle(resolved.tradeId)).toBe('IGNORED');
      expect(await settle(randomUUID())).toBe('UNKNOWN_TRADE');
    });
  });
});
