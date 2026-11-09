/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- raw `pg` rows are untyped in assertions */
// T-064 deadlines against the real database: opening the delivery deadline, the extension request
// and answer (DE1, DE2) and the overdue sweep (DE3, DE4). The sweep is the job body, so its
// idempotency, hold handling and refund seam are tested here directly.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import {
  getDeliveryDeadline,
  openDeliveryDeadline,
  requestExtension,
  respondToExtension,
  sweepDeliveryDeadlines,
} from '../../../../src/modules/trades/services/deadline.service.js';
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

const H = 3_600_000;
const DAY = 24 * H;

describe.runIf(infraEnabled)('delivery deadlines (T-064)', () => {
  const t = useTestDatabase();
  const world = newWorld();
  const deps = () => fulfilmentDeps(t, world);

  const open = (tradeId: string) => t.db().transaction((tx) => openDeliveryDeadline(deps(), tx, tradeId));

  const insertDeadline = (tradeId: string, dueAt: Date, overrides: Record<string, unknown> = {}) =>
    insertRow(t.owner(), 'trade.trade_deadlines', {
      trade_id: tradeId,
      kind: 'DELIVERY',
      due_at: dueAt.toISOString(),
      original_due_at: dueAt.toISOString(),
      ...overrides,
    });

  const deadline = async (id: string) =>
    (await t.owner().query(`SELECT * FROM trade.trade_deadlines WHERE id = $1`, [id])).rows[0];

  describe('opening', () => {
    it('is the funding time plus the pinned category window, once', async () => {
      const { tradeId } = await tradeAt(t, 'FUNDED');
      const first = await open(tradeId);
      const again = await open(tradeId);
      expect(again?.id).toBe(first?.id);
      const { rows } = await t
        .owner()
        .query(`SELECT * FROM trade.trade_deadlines WHERE trade_id = $1`, [tradeId]);
      expect(rows).toHaveLength(1);
      const funded = (await t.owner().query(`SELECT funded_at FROM trade.trades WHERE id = $1`, [tradeId]))
        .rows[0];
      expect(rows[0].kind).toBe('DELIVERY');
      expect(new Date(rows[0].due_at).getTime() - new Date(funded.funded_at).getTime()).toBe(7 * DAY);
      expect(new Date(rows[0].original_due_at).getTime()).toBe(new Date(rows[0].due_at).getTime());
      const activity = await t
        .owner()
        .query(`SELECT 1 FROM trade.trade_activity WHERE trade_id = $1 AND type = 'DEADLINE_SET'`, [tradeId]);
      expect(activity.rows).toHaveLength(1);
    });

    it('does not open one for a trade that is not funded or shipped', async () => {
      const { tradeId } = await tradeAt(t, 'PENDING_PAYMENT');
      expect(await open(tradeId)).toBeNull();
      const done = await tradeAt(t, 'INSPECTION');
      expect(await open(done.tradeId)).toBeNull();
    });

    it('does not reopen a deadline that already elapsed', async () => {
      const { tradeId } = await tradeAt(t, 'FUNDED');
      await insertDeadline(tradeId, new Date(Date.now() - H), {
        status: 'ELAPSED',
        resolved_at: new Date().toISOString(),
      });
      expect(await open(tradeId)).toBeNull();
    });
  });

  describe('extension request and answer (DE1, DE2)', () => {
    const funded = async () => {
      const fixture = await tradeAt(t, 'FUNDED');
      const dueAt = new Date(Date.now() + 6 * H);
      const deadlineId = await insertDeadline(fixture.tradeId, dueAt);
      return { ...fixture, deadlineId, dueAt };
    };
    const ask = (
      f: { tradeId: string; seller: string; dueAt: Date },
      overrides: Record<string, unknown> = {},
    ) =>
      requestExtension(deps(), {
        userId: f.seller,
        tradeId: f.tradeId,
        reason: 'COURIER_PICKUP_DELAYED',
        requestedDueAt: new Date(f.dueAt.getTime() + DAY),
        ...overrides,
      });

    it('the seller asks, the buyer is told, the deadline does not move yet', async () => {
      const f = await funded();
      const request = await ask(f, { note: 'Rider is sick' });
      expect(request).toMatchObject({
        status: 'PENDING',
        reason: 'COURIER_PICKUP_DELAYED',
        note: 'Rider is sick',
      });
      expect(new Date((await deadline(f.deadlineId)).due_at).getTime()).toBe(f.dueAt.getTime());
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.delivery_extension.requested')).toHaveLength(1);
    });

    it('is idempotent for the same request, and refuses a different one while one is open', async () => {
      const f = await funded();
      const first = await ask(f);
      expect((await ask(f)).id).toBe(first.id);
      expect(await failure(ask(f, { requestedDueAt: new Date(f.dueAt.getTime() + 2 * DAY) }))).toMatchObject({
        status: 409,
      });
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.delivery_extension.requested')).toHaveLength(1);
    });

    it('validates the date and who is asking', async () => {
      const f = await funded();
      expect(await failure(ask(f, { requestedDueAt: new Date(f.dueAt.getTime() - H) }))).toMatchObject({
        status: 422,
        code: 'VALIDATION_FAILED',
      });
      expect(await failure(ask(f, { requestedDueAt: new Date(f.dueAt.getTime() + 8 * DAY) }))).toMatchObject({
        status: 422,
      });
      expect(await failure(ask({ ...f, seller: f.buyer }))).toMatchObject({ status: 403 });
      expect(await failure(ask({ ...f, seller: await person(t) }))).toMatchObject({ status: 404 });
    });

    it('refuses once the deadline has passed', async () => {
      const f = await tradeAt(t, 'FUNDED');
      await insertDeadline(f.tradeId, new Date(Date.now() - H));
      expect(
        await failure(
          ask({ ...f, dueAt: new Date(Date.now() - H) }, { requestedDueAt: new Date(Date.now() + DAY) }),
        ),
      ).toMatchObject({ status: 409 });
    });

    it('works on a shipped trade, and not once delivery has been signalled', async () => {
      const shipped = await tradeAt(t, 'SHIPPED');
      const dueAt = new Date(Date.now() + 6 * H);
      await insertDeadline(shipped.tradeId, dueAt);
      await expect(ask({ ...shipped, dueAt })).resolves.toMatchObject({ status: 'PENDING' });
      const inspecting = await tradeAt(t, 'INSPECTION');
      await insertDeadline(inspecting.tradeId, dueAt);
      expect(await failure(ask({ ...inspecting, dueAt }))).toMatchObject({
        status: 409,
        code: 'INVALID_TRANSITION',
      });
    });

    it('the buyer accepts: the deadline moves later, once, and the escrow is untouched', async () => {
      const f = await funded();
      const request = await ask(f);
      const answered = await respondToExtension(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        requestId: request.id,
        decision: 'ACCEPT',
      });
      expect(answered.status).toBe('ACCEPTED');
      const row = await deadline(f.deadlineId);
      expect(new Date(row.due_at).getTime()).toBe(f.dueAt.getTime() + DAY);
      expect(new Date(row.original_due_at).getTime()).toBe(f.dueAt.getTime());
      expect(row).toMatchObject({
        extension_count: 1,
        extended_by_actor_type: 'BUYER',
        extended_by_actor_id: f.buyer,
        status: 'PENDING',
      });
      expect(await statusOf(t.owner(), f.tradeId)).toBe('FUNDED');
      const again = await respondToExtension(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        requestId: request.id,
        decision: 'ACCEPT',
      });
      expect(again.status).toBe('ACCEPTED');
      expect((await deadline(f.deadlineId)).extension_count).toBe(1);
      const activity = await t
        .owner()
        .query(`SELECT 1 FROM trade.trade_activity WHERE trade_id = $1 AND type = 'DEADLINE_EXTENDED'`, [
          f.tradeId,
        ]);
      expect(activity.rows).toHaveLength(1);
      expect((await outboxOf(t.owner(), f.tradeId, 'trades.delivery_extension.responded'))[0]).toMatchObject({
        decision: 'ACCEPTED',
      });
    });

    it('the buyer declines: the original date stands and the seller cannot ask again', async () => {
      const f = await funded();
      const request = await ask(f);
      const answered = await respondToExtension(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        requestId: request.id,
        decision: 'DECLINE',
      });
      expect(answered.status).toBe('DECLINED');
      expect(new Date((await deadline(f.deadlineId)).due_at).getTime()).toBe(f.dueAt.getTime());
      expect(await failure(ask(f))).toMatchObject({ status: 409 });
    });

    it('only the buyer answers, a decision cannot be flipped, and an accepted date cannot be taken after it passed', async () => {
      const f = await funded();
      const request = await ask(f);
      expect(
        await failure(
          respondToExtension(deps(), {
            userId: f.seller,
            tradeId: f.tradeId,
            requestId: request.id,
            decision: 'ACCEPT',
          }),
        ),
      ).toMatchObject({ status: 403 });
      await respondToExtension(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        requestId: request.id,
        decision: 'DECLINE',
      });
      expect(
        await failure(
          respondToExtension(deps(), {
            userId: f.buyer,
            tradeId: f.tradeId,
            requestId: request.id,
            decision: 'ACCEPT',
          }),
        ),
      ).toMatchObject({ status: 409 });

      const late = await funded();
      const lateRequest = await ask(late);
      await t
        .owner()
        .query(`UPDATE trade.trade_deadlines SET due_at = $2, original_due_at = $2 WHERE id = $1`, [
          late.deadlineId,
          new Date(Date.now() - H).toISOString(),
        ]);
      await t
        .owner()
        .query(
          `UPDATE trade.delivery_extension_requests SET current_due_at = $2::timestamptz - interval '1 hour' WHERE id = $1`,
          [lateRequest.id, new Date(Date.now() - H).toISOString()],
        );
      expect(
        await failure(
          respondToExtension(deps(), {
            userId: late.buyer,
            tradeId: late.tradeId,
            requestId: lateRequest.id,
            decision: 'ACCEPT',
          }),
        ),
      ).toMatchObject({ status: 409 });
    });

    it('shows both parties the deadline and the open request', async () => {
      const f = await funded();
      const request = await ask(f);
      for (const userId of [f.buyer, f.seller]) {
        const view = await getDeliveryDeadline(deps(), { userId, tradeId: f.tradeId });
        expect(view.deadline).toMatchObject({ status: 'PENDING', extensionCount: 0 });
        expect(view.extensionRequest).toMatchObject({ id: request.id, status: 'PENDING' });
      }
      expect(
        await failure(getDeliveryDeadline(deps(), { userId: await person(t), tradeId: f.tradeId })),
      ).toMatchObject({ status: 404 });
    });
  });

  describe('the overdue sweep (DE3, DE4)', () => {
    const overdue = async (status = 'FUNDED') => {
      const fixture = await tradeAt(t, status);
      const deadlineId = await insertDeadline(fixture.tradeId, new Date(Date.now() - H));
      return { ...fixture, deadlineId };
    };
    const sweep = () => sweepDeliveryDeadlines(deps());

    it('leaves a deadline that is not due yet alone', async () => {
      const fixture = await tradeAt(t, 'FUNDED');
      const deadlineId = await insertDeadline(fixture.tradeId, new Date(Date.now() + H));
      expect(await sweep()).toMatchObject({ examined: 0 });
      expect((await deadline(deadlineId)).status).toBe('PENDING');
    });

    it('requests a refund for a funded trade with nothing shipped, and only the request', async () => {
      const f = await overdue();
      const result = await sweep();
      expect(result).toMatchObject({ REFUND_REQUESTED: 1 });
      expect((await deadline(f.deadlineId)).status).toBe('ELAPSED');

      const requests = await outboxOf(t.owner(), f.tradeId, 'trades.refund.requested');
      expect(requests).toEqual([
        expect.objectContaining({
          tradeId: f.tradeId,
          reason: 'DELIVERY_OVERDUE',
          scope: 'FULL',
          deadlineId: f.deadlineId,
        }),
      ]);
      expect(requests[0]).not.toHaveProperty('amountMinor');
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.delivery.overdue')).toEqual([
        expect.objectContaining({ status: 'FUNDED', refundRequested: true }),
      ]);
      // The seam: no refund service is called, no escrow request is written, and the trade has not moved.
      expect(await statusOf(t.owner(), f.tradeId)).toBe('FUNDED');
      expect((await t.owner().query(`SELECT 1 FROM trade.escrow_action_requests`)).rows).toHaveLength(0);
      const types = (
        await t
          .owner()
          .query(`SELECT type FROM trade.trade_activity WHERE trade_id = $1 ORDER BY id`, [f.tradeId])
      ).rows.map((r) => r.type);
      expect(types).toEqual(expect.arrayContaining(['DEADLINE_ELAPSED', 'ESCROW_ACTION_REQUESTED']));
    });

    it('is idempotent: a second sweep, or two at once, publish the request exactly once', async () => {
      const f = await overdue();
      await Promise.all([sweep(), sweep()]);
      await sweep();
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.refund.requested')).toHaveLength(1);
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.delivery.overdue')).toHaveLength(1);
    });

    it('waits while a hold is active and acts once it is released', async () => {
      const f = await overdue();
      const holdId = await insertRow(t.owner(), 'trade.trade_holds', {
        trade_id: f.tradeId,
        source: 'ADMIN',
        reason: 'frozen for review',
        placed_by_actor_type: 'STAFF',
        placed_by_actor_id: await person(t),
      });
      expect(await sweep()).toMatchObject({ WAIT: 1 });
      expect((await deadline(f.deadlineId)).status).toBe('PENDING');
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.refund.requested')).toHaveLength(0);

      await t.owner().query(`UPDATE trade.trade_holds SET released_at = now() WHERE id = $1`, [holdId]);
      expect(await sweep()).toMatchObject({ REFUND_REQUESTED: 1 });
    });

    it('lapses an unanswered request once the original date has passed, and refunds', async () => {
      const f = await tradeAt(t, 'FUNDED');
      const dueAt = new Date(Date.now() + 2 * H);
      const deadlineId = await insertDeadline(f.tradeId, dueAt);
      const request = await requestExtension(deps(), {
        userId: f.seller,
        tradeId: f.tradeId,
        reason: 'RESTOCKING_ITEM',
        requestedDueAt: new Date(dueAt.getTime() + DAY),
      });
      // Time passes with the buyer silent.
      await t
        .owner()
        .query(
          `UPDATE trade.trade_deadlines SET due_at = now() - interval '1 hour', original_due_at = now() - interval '1 hour' WHERE id = $1`,
          [deadlineId],
        );
      await t
        .owner()
        .query(
          `UPDATE trade.delivery_extension_requests SET current_due_at = now() - interval '2 hour' WHERE id = $1`,
          [request.id],
        );

      expect(await sweep()).toMatchObject({ REFUND_REQUESTED: 1 });
      expect((await deadline(deadlineId)).status).toBe('ELAPSED');
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.refund.requested')).toHaveLength(1);
      const row = (
        await t
          .owner()
          .query(`SELECT status, responded_at FROM trade.delivery_extension_requests WHERE id = $1`, [
            request.id,
          ])
      ).rows[0];
      expect(row).toEqual({ status: 'LAPSED', responded_at: null });
      const lapsed = await t
        .owner()
        .query(
          `SELECT 1 FROM trade.trade_activity WHERE trade_id = $1 AND metadata ->> 'event' = 'EXTENSION_LAPSED'`,
          [f.tradeId],
        );
      expect(lapsed.rows).toHaveLength(1);
      // Too late to grant it now.
      expect(
        await failure(
          respondToExtension(deps(), {
            userId: f.buyer,
            tradeId: f.tradeId,
            requestId: request.id,
            decision: 'ACCEPT',
          }),
        ),
      ).toMatchObject({ status: 409, extensions: { reason: 'EXTENSION_LAPSED' } });
    });

    it('an extension the buyer accepted in time keeps the deadline from firing', async () => {
      const f = await tradeAt(t, 'FUNDED');
      const dueAt = new Date(Date.now() + 2 * H);
      const deadlineId = await insertDeadline(f.tradeId, dueAt);
      const request = await requestExtension(deps(), {
        userId: f.seller,
        tradeId: f.tradeId,
        reason: 'RESTOCKING_ITEM',
        requestedDueAt: new Date(dueAt.getTime() + DAY),
      });
      await respondToExtension(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        requestId: request.id,
        decision: 'ACCEPT',
      });
      expect(await sweep()).toMatchObject({ examined: 0 });
      expect((await deadline(deadlineId)).status).toBe('PENDING');
    });

    it('a decline after the date refunds at once', async () => {
      const f = await tradeAt(t, 'FUNDED');
      const dueAt = new Date(Date.now() + 2 * H);
      const deadlineId = await insertDeadline(f.tradeId, dueAt);
      const request = await requestExtension(deps(), {
        userId: f.seller,
        tradeId: f.tradeId,
        reason: 'RESTOCKING_ITEM',
        requestedDueAt: new Date(dueAt.getTime() + DAY),
      });
      await respondToExtension(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        requestId: request.id,
        decision: 'DECLINE',
      });
      await t
        .owner()
        .query(
          `UPDATE trade.trade_deadlines SET due_at = now() - interval '1 hour', original_due_at = now() - interval '1 hour' WHERE id = $1`,
          [deadlineId],
        );
      await sweep();
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.refund.requested')).toHaveLength(1);
    });

    it('only elapses a shipped trade: no refund after dispatch (open question for the owner)', async () => {
      const f = await overdue('SHIPPED');
      expect(await sweep()).toMatchObject({ ELAPSED_NO_REFUND: 1 });
      expect((await deadline(f.deadlineId)).status).toBe('ELAPSED');
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.refund.requested')).toHaveLength(0);
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.delivery.overdue')).toEqual([
        expect.objectContaining({ status: 'SHIPPED', refundRequested: false }),
      ]);
      expect(await statusOf(t.owner(), f.tradeId)).toBe('SHIPPED');
    });

    it('closes the deadline as met once delivery was signalled, and cancels it for a trade that left fulfilment', async () => {
      const delivered = await overdue('INSPECTION');
      const disputed = await overdue('DISPUTED');
      await sweep();
      expect((await deadline(delivered.deadlineId)).status).toBe('MET');
      expect((await deadline(disputed.deadlineId)).status).toBe('CANCELLED');
      expect(await outboxOf(t.owner(), delivered.tradeId, 'trades.refund.requested')).toHaveLength(0);
      expect(await outboxOf(t.owner(), disputed.tradeId, 'trades.refund.requested')).toHaveLength(0);
    });

    it('re-checks the state it reads: a trade shipped just before the sweep is not refunded', async () => {
      const f = await overdue('FUNDED');
      // The seller ships between the job being queued and it running; the sweep reads the trade fresh.
      await t
        .owner()
        .query(
          `UPDATE trade.trades SET status = 'SHIPPED', status_action = 'BEGIN_CUSTODY', status_actor_type = 'SYSTEM', status_revision = status_revision + 1 WHERE id = $1`,
          [f.tradeId],
        );
      expect(await sweep()).toMatchObject({ ELAPSED_NO_REFUND: 1 });
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.refund.requested')).toHaveLength(0);
    });
  });
});
