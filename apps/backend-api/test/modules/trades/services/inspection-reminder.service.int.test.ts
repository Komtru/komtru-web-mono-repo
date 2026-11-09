/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- raw `pg` rows are untyped in assertions */
// T-068's inspection reminder against the real database: once per deadline, only while the buyer can
// act, and safe to run concurrently. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import {
  requestInspectionExtension,
  respondToInspectionExtension,
} from '../../../../src/modules/trades/services/inspection.service.js';
import { sweepInspectionReminders } from '../../../../src/modules/trades/services/inspectionReminder.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { newWorld, outboxOf } from './fulfilment-support.js';
import {
  deadlineRow,
  H,
  inspectionDeps,
  placeHold,
  releaseHold,
  trade,
  tradeRow,
} from './inspection-support.js';

describe.runIf(infraEnabled)('inspection reminders (T-068)', () => {
  const t = useTestDatabase();
  const world = newWorld();
  const seam = { dispute: false };
  const deps = () => inspectionDeps(t, world, seam);
  const reset = () => {
    world.clock.now = new Date();
    seam.dispute = false;
  };
  const reminders = (tradeId: string) => outboxOf(t.owner(), tradeId, 'trades.inspection.reminder_due');

  it('publishes one reminder for a window closing within a day, and stamps the deadline', async () => {
    reset();
    const f = await trade(t, 'INSPECTION', 10);
    expect(await sweepInspectionReminders(deps())).toMatchObject({ examined: 1, REMINDED: 1 });

    const [event] = await reminders(f.tradeId);
    expect(event).toMatchObject({ tradeId: f.tradeId, deadlineId: f.deadlineId });
    expect(new Date(event!.dueAt as string).getTime()).toBeGreaterThan(Date.now());
    expect((await deadlineRow(t, f.deadlineId)).reminder_sent_at).not.toBeNull();
  });

  it('sends it once, however many times the sweep runs, and once under concurrent sweeps', async () => {
    reset();
    const f = await trade(t, 'INSPECTION', 10);
    await Promise.all([sweepInspectionReminders(deps()), sweepInspectionReminders(deps())]);
    await sweepInspectionReminders(deps());
    expect(await reminders(f.tradeId)).toHaveLength(1);
  });

  it('does not remind early, after the deadline, or for a trade that is not in inspection', async () => {
    reset();
    const early = await trade(t, 'INSPECTION', 60);
    const late = await trade(t, 'INSPECTION', -1);
    const unconfirmed = await trade(t, 'UNCONFIRMED_DELIVERY', 5);
    await sweepInspectionReminders(deps());
    for (const f of [early, late, unconfirmed]) expect(await reminders(f.tradeId)).toEqual([]);
    expect((await deadlineRow(t, early.deadlineId)).reminder_sent_at).toBeNull();
  });

  it('uses half of a short window as the lead', async () => {
    reset();
    const f = await trade(t, 'INSPECTION', 6, { windowHours: 10 });
    await sweepInspectionReminders(deps());
    expect(await reminders(f.tradeId)).toEqual([]);

    await t.owner().query(
      `UPDATE trade.trade_deadlines
            SET due_at = now() + interval '4 hours', original_due_at = now() + interval '4 hours'
          WHERE id = $1`,
      [f.deadlineId],
    );
    await sweepInspectionReminders(deps());
    expect(await reminders(f.tradeId)).toHaveLength(1);
  });

  it('holds the reminder back while a hold or a dispute stops the buyer acting, then sends it', async () => {
    reset();
    const f = await trade(t, 'INSPECTION', 10);
    const hold = await placeHold(t, f.tradeId);
    seam.dispute = true;
    await sweepInspectionReminders(deps());
    expect(await reminders(f.tradeId)).toEqual([]);

    seam.dispute = false;
    await sweepInspectionReminders(deps());
    expect(await reminders(f.tradeId)).toEqual([]);

    await releaseHold(t, hold);
    await sweepInspectionReminders(deps());
    expect(await reminders(f.tradeId)).toHaveLength(1);
  });

  it('reminds again, once, when an accepted extension moves the deadline', async () => {
    reset();
    const f = await trade(t, 'INSPECTION', 10);
    await sweepInspectionReminders(deps());
    expect(await reminders(f.tradeId)).toHaveLength(1);

    const request = await requestInspectionExtension(deps(), {
      userId: f.buyer,
      tradeId: f.tradeId,
      extraHours: 36,
    });
    await respondToInspectionExtension(deps(), {
      userId: f.seller,
      tradeId: f.tradeId,
      requestId: request.id,
      decision: 'ACCEPT',
    });
    expect((await deadlineRow(t, f.deadlineId)).reminder_sent_at).toBeNull();

    // Not yet: the new deadline is 46 hours away.
    await sweepInspectionReminders(deps());
    expect(await reminders(f.tradeId)).toHaveLength(1);

    // Once it is inside the lead, the buyer is warned about the NEW deadline, and only once.
    world.clock.now = new Date(Date.now() + 30 * H);
    await sweepInspectionReminders(deps());
    await sweepInspectionReminders(deps());
    const sent = await reminders(f.tradeId);
    expect(sent).toHaveLength(2);
    expect(new Date(sent[1]!.dueAt as string).getTime()).toBeGreaterThan(
      new Date(sent[0]!.dueAt as string).getTime(),
    );
  });

  it('does not re-arm when the request is declined', async () => {
    reset();
    const f = await trade(t, 'INSPECTION', 10);
    await sweepInspectionReminders(deps());
    const request = await requestInspectionExtension(deps(), {
      userId: f.buyer,
      tradeId: f.tradeId,
      extraHours: 36,
    });
    await respondToInspectionExtension(deps(), {
      userId: f.seller,
      tradeId: f.tradeId,
      requestId: request.id,
      decision: 'DECLINE',
    });
    expect((await deadlineRow(t, f.deadlineId)).reminder_sent_at).not.toBeNull();
  });

  it('leaves the trade itself untouched', async () => {
    reset();
    const f = await trade(t, 'INSPECTION', 10);
    const before = await tradeRow(t, f.tradeId);
    await sweepInspectionReminders(deps());
    const after = await tradeRow(t, f.tradeId);
    expect(after.status).toBe('INSPECTION');
    expect(after.status_revision).toBe(before.status_revision);
    expect(H).toBe(3_600_000);
  });
});
