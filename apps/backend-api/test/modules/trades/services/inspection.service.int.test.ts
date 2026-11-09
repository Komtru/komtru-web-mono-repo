/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- raw `pg` rows are untyped in assertions */
// T-065's inspection against the real database: the Z4 comparison, the buyer's one request for more
// time (BEI1) and the seller's answer (BEI2), and confirm-and-release with acknowledgement (Z5).
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  confirmAndRelease,
  getInspection,
  requestInspectionExtension,
  respondToInspectionExtension,
} from '../../../../src/modules/trades/services/inspection.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertRow } from '../support.js';
import { failure, newWorld, outboxOf, person, statusOf } from './fulfilment-support.js';
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

describe.runIf(infraEnabled)('inspection (T-065)', () => {
  const t = useTestDatabase();
  const world = newWorld();
  const seam = { dispute: false };
  const deps = () => inspectionDeps(t, world, seam);

  const reset = () => {
    world.clock.now = new Date();
    seam.dispute = false;
  };

  describe('Z4: comparing the proof with the delivery evidence', () => {
    it('shows both parties the seller proof, the delivery signals and the self-arranged waybill', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 72);
      await insertRow(t.owner(), 'trade.delivery_signals', {
        trade_id: f.tradeId,
        source: 'BUYER_CONFIRMATION',
        reported_by: f.buyer,
      });
      const receipt = randomUUID();
      await insertRow(t.owner(), 'trade.self_arranged_shipments', {
        trade_id: f.tradeId,
        waybill_number: 'WB-998877',
        receipt_file_id: receipt,
        driver_phone: '+2348031234567',
        vehicle_plate: 'ABC-123 DE',
        shipped_by_user_id: f.seller,
      });

      const asBuyer = await getInspection(deps(), { userId: f.buyer, tradeId: f.tradeId });
      expect(asBuyer.yourRole).toBe('BUYER');
      expect(asBuyer.sellerProof.media).toHaveLength(1);
      expect(asBuyer.deliveryEvidence.signals.map((s) => s.source)).toEqual(['BUYER_CONFIRMATION']);
      expect(asBuyer.deliveryEvidence.selfArranged).toMatchObject({
        waybillNumber: 'WB-998877',
        receiptFileId: receipt,
        vehiclePlate: 'ABC-123 DE',
      });
      // The driver's number is the seller's to see, not the buyer's.
      expect(asBuyer.deliveryEvidence.selfArranged).not.toHaveProperty('driverPhone');
      expect(asBuyer.canRequestMoreTime).toBe(true);
      expect(asBuyer.window).toMatchObject({ hours: 72, extended: false, autoReleasePaused: false });

      const asSeller = await getInspection(deps(), { userId: f.seller, tradeId: f.tradeId });
      expect(asSeller.deliveryEvidence.selfArranged).toHaveProperty('driverPhone', '+2348031234567');
      expect(asSeller.canRequestMoreTime).toBe(false);
    });

    it('says only that the release is paused under a hold, and treats a stranger as not found', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 72);
      await placeHold(t, f.tradeId);
      const view = await getInspection(deps(), { userId: f.buyer, tradeId: f.tradeId });
      expect(view.window.autoReleasePaused).toBe(true);
      expect(JSON.stringify(view)).not.toContain('frozen for review');
      const stranger = await person(t);
      expect((await failure(getInspection(deps(), { userId: stranger, tradeId: f.tradeId }))).status).toBe(
        404,
      );
    });
  });

  describe('BEI1: the buyer asks for more time, once', () => {
    it('records a pending request without moving the deadline', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 24);
      const before = await deadlineRow(t, f.deadlineId);
      const request = await requestInspectionExtension(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        extraHours: 24,
        note: 'out of town',
      });
      expect(request).toMatchObject({ status: 'PENDING', extraHours: 24, note: 'out of town' });
      expect(new Date(request.requestedDueAt).getTime() - new Date(request.currentDueAt).getTime()).toBe(
        24 * H,
      );
      expect((await deadlineRow(t, f.deadlineId)).due_at).toEqual(before.due_at);
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.inspection_extension.requested')).toHaveLength(1);
      const view = await getInspection(deps(), { userId: f.seller, tradeId: f.tradeId });
      expect(view.extensionRequest?.id).toBe(request.id);
      expect(view.canRespondToRequest).toBe(true);
    });

    it('repeats the same request harmlessly, and refuses any second one', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 24);
      const first = await requestInspectionExtension(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        extraHours: 12,
      });
      const again = await requestInspectionExtension(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        extraHours: 12,
      });
      expect(again.id).toBe(first.id);
      const other = await failure(
        requestInspectionExtension(deps(), { userId: f.buyer, tradeId: f.tradeId, extraHours: 6 }),
      );
      expect(other.status).toBe(409);
      expect(other.extensions).toMatchObject({ reason: 'EXTENSION_ALREADY_REQUESTED' });
    });

    it('stays refused after the seller declined: once means once', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 24);
      const request = await requestInspectionExtension(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        extraHours: 12,
      });
      await respondToInspectionExtension(deps(), {
        userId: f.seller,
        tradeId: f.tradeId,
        requestId: request.id,
        decision: 'DECLINE',
      });
      const second = await failure(
        requestInspectionExtension(deps(), { userId: f.buyer, tradeId: f.tradeId, extraHours: 12 }),
      );
      expect(second.extensions).toMatchObject({ reason: 'EXTENSION_ALREADY_REQUESTED' });
    });

    it('lets two concurrent requests produce one row', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 24);
      const results = await Promise.allSettled([
        requestInspectionExtension(deps(), { userId: f.buyer, tradeId: f.tradeId, extraHours: 10 }),
        requestInspectionExtension(deps(), { userId: f.buyer, tradeId: f.tradeId, extraHours: 11 }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const { rows } = await t
        .owner()
        .query(`SELECT 1 FROM trade.inspection_extension_requests WHERE trade_id = $1`, [f.tradeId]);
      expect(rows).toHaveLength(1);
    });

    it('is the buyer only, in INSPECTION only, before the window ends, within one window', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 24);
      expect(
        (
          await failure(
            requestInspectionExtension(deps(), { userId: f.seller, tradeId: f.tradeId, extraHours: 5 }),
          )
        ).status,
      ).toBe(403);
      const tooLong = await failure(
        requestInspectionExtension(deps(), { userId: f.buyer, tradeId: f.tradeId, extraHours: 73 }),
      );
      expect(tooLong.status).toBe(422);
      const zero = await failure(
        requestInspectionExtension(deps(), { userId: f.buyer, tradeId: f.tradeId, extraHours: 0 }),
      );
      expect(zero.status).toBe(422);

      const late = await trade(t, 'INSPECTION', -1);
      const elapsed = await failure(
        requestInspectionExtension(deps(), { userId: late.buyer, tradeId: late.tradeId, extraHours: 5 }),
      );
      expect(elapsed.extensions).toMatchObject({ reason: 'ALREADY_ELAPSED' });

      const grace = await trade(t, 'UNCONFIRMED_DELIVERY', 24);
      expect(
        (
          await failure(
            requestInspectionExtension(deps(), {
              userId: grace.buyer,
              tradeId: grace.tradeId,
              extraHours: 5,
            }),
          )
        ).status,
      ).toBe(409);
    });
  });

  describe('BEI2: the seller answers', () => {
    it('moves the deadline, on the row and on the trade, when the seller accepts', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 24);
      const request = await requestInspectionExtension(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        extraHours: 24,
      });
      const answered = await respondToInspectionExtension(deps(), {
        userId: f.seller,
        tradeId: f.tradeId,
        requestId: request.id,
        decision: 'ACCEPT',
      });
      expect(answered.status).toBe('ACCEPTED');
      const row = await deadlineRow(t, f.deadlineId);
      expect(new Date(row.due_at).toISOString()).toBe(request.requestedDueAt);
      expect(new Date(row.original_due_at).toISOString()).toBe(request.currentDueAt);
      expect(row.extension_count).toBe(1);
      expect(row.extended_by_actor_type).toBe('SELLER');
      expect(new Date((await tradeRow(t, f.tradeId)).inspection_deadline_at).toISOString()).toBe(
        request.requestedDueAt,
      );
      const events = await outboxOf(t.owner(), f.tradeId, 'trades.inspection_extension.responded');
      expect(events).toEqual([
        expect.objectContaining({ decision: 'ACCEPTED', newDueAt: request.requestedDueAt }),
      ]);
      // A repeat is the same answer, not a second extension.
      await respondToInspectionExtension(deps(), {
        userId: f.seller,
        tradeId: f.tradeId,
        requestId: request.id,
        decision: 'ACCEPT',
      });
      expect((await deadlineRow(t, f.deadlineId)).extension_count).toBe(1);
    });

    it('leaves the deadline where it was when the seller declines', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 24);
      const before = await deadlineRow(t, f.deadlineId);
      const request = await requestInspectionExtension(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        extraHours: 24,
      });
      const answered = await respondToInspectionExtension(deps(), {
        userId: f.seller,
        tradeId: f.tradeId,
        requestId: request.id,
        decision: 'DECLINE',
      });
      expect(answered.status).toBe('DECLINED');
      expect((await deadlineRow(t, f.deadlineId)).due_at).toEqual(before.due_at);
      const other = await failure(
        respondToInspectionExtension(deps(), {
          userId: f.seller,
          tradeId: f.tradeId,
          requestId: request.id,
          decision: 'ACCEPT',
        }),
      );
      expect(other.extensions).toMatchObject({ reason: 'EXTENSION_ALREADY_ANSWERED' });
    });

    it('is the seller only, and refuses to reopen a window that already ended', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 24);
      const request = await requestInspectionExtension(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        extraHours: 24,
      });
      expect(
        (
          await failure(
            respondToInspectionExtension(deps(), {
              userId: f.buyer,
              tradeId: f.tradeId,
              requestId: request.id,
              decision: 'ACCEPT',
            }),
          )
        ).status,
      ).toBe(403);
      world.clock.now = new Date(Date.now() + 25 * H);
      const late = await failure(
        respondToInspectionExtension(deps(), {
          userId: f.seller,
          tradeId: f.tradeId,
          requestId: request.id,
          decision: 'ACCEPT',
        }),
      );
      expect(late.extensions).toMatchObject({ reason: 'ALREADY_ELAPSED' });
      expect(await statusOf(t.owner(), f.tradeId)).toBe('INSPECTION');
    });
  });

  describe('Z5: confirm and release', () => {
    it('completes the trade, keeps the acknowledgement, closes the deadline and announces it', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 24);
      const view = await confirmAndRelease(deps(), { userId: f.buyer, tradeId: f.tradeId });
      expect(view.status).toBe('COMPLETED');
      expect(await statusOf(t.owner(), f.tradeId)).toBe('COMPLETED');
      expect((await tradeRow(t, f.tradeId)).completed_at).not.toBeNull();
      const [change] = await stateChanges(t, f.tradeId, 'COMPLETE');
      expect(change).toMatchObject({
        from_status: 'INSPECTION',
        to_status: 'COMPLETED',
        actor_type: 'BUYER',
      });
      expect(change.actor_id).toBe(f.buyer);

      const { rows: acks } = await t
        .owner()
        .query(`SELECT * FROM trade.inspection_acknowledgements WHERE trade_id = $1`, [f.tradeId]);
      expect(acks).toHaveLength(1);
      expect(acks[0]).toMatchObject({ buyer_user_id: f.buyer, statement_code: 'RELEASE_IS_FINAL_V1' });
      expect((await deadlineRow(t, f.deadlineId)).status).toBe('MET');

      // The ledger releases on the state change; the completed event says how it got there.
      const changed = await outboxOf(t.owner(), f.tradeId, 'trades.trade.state_changed');
      expect(changed).toContainEqual(expect.objectContaining({ from: 'INSPECTION', to: 'COMPLETED' }));
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.trade.completed')).toEqual([
        expect.objectContaining({ via: 'BUYER_CONFIRMED' }),
      ]);
    });

    it('settles a pending request for more time as cancelled', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 24);
      await requestInspectionExtension(deps(), { userId: f.buyer, tradeId: f.tradeId, extraHours: 24 });
      await confirmAndRelease(deps(), { userId: f.buyer, tradeId: f.tradeId });
      const { rows } = await t
        .owner()
        .query(`SELECT status FROM trade.inspection_extension_requests WHERE trade_id = $1`, [f.tradeId]);
      expect(rows).toEqual([{ status: 'CANCELLED' }]);
    });

    it('returns the trade as it stands when the same buyer repeats it', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 24);
      await confirmAndRelease(deps(), { userId: f.buyer, tradeId: f.tradeId });
      const again = await confirmAndRelease(deps(), { userId: f.buyer, tradeId: f.tradeId });
      expect(again.status).toBe('COMPLETED');
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.trade.completed')).toHaveLength(1);
      expect(await stateChanges(t, f.tradeId, 'COMPLETE')).toHaveLength(1);
    });

    it('is refused for the seller, outside INSPECTION, under a hold and while a dispute is open', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 24);
      expect(
        (await failure(confirmAndRelease(deps(), { userId: f.seller, tradeId: f.tradeId }))).status,
      ).toBe(403);

      const hold = await placeHold(t, f.tradeId);
      const held = await failure(confirmAndRelease(deps(), { userId: f.buyer, tradeId: f.tradeId }));
      expect(held.status).toBe(409);
      expect(held.extensions).toMatchObject({ reason: 'HOLD_ACTIVE' });
      expect(await statusOf(t.owner(), f.tradeId)).toBe('INSPECTION');
      await releaseHold(t, hold);

      seam.dispute = true;
      const disputed = await failure(confirmAndRelease(deps(), { userId: f.buyer, tradeId: f.tradeId }));
      expect(disputed.extensions).toMatchObject({ reason: 'DISPUTE_OPEN' });
      expect(await statusOf(t.owner(), f.tradeId)).toBe('INSPECTION');
      seam.dispute = false;

      const grace = await trade(t, 'UNCONFIRMED_DELIVERY', 24);
      const early = await failure(confirmAndRelease(deps(), { userId: grace.buyer, tradeId: grace.tradeId }));
      expect(early.status).toBe(409);
      expect(early.code).toBe('INVALID_TRANSITION');
    });

    it('does not accept a different buyer after an auto-completion: no acknowledgement exists', async () => {
      reset();
      const f = await trade(t, 'INSPECTION', 24);
      await t
        .owner()
        .query(
          `UPDATE trade.trades SET status = 'COMPLETED', status_action = 'INSPECTION_ELAPSED', status_revision = status_revision + 1 WHERE id = $1`,
          [f.tradeId],
        );
      const late = await failure(confirmAndRelease(deps(), { userId: f.buyer, tradeId: f.tradeId }));
      expect(late.status).toBe(409);
    });
  });
});
