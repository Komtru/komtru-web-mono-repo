/* eslint-disable @typescript-eslint/no-unsafe-return -- raw `pg` rows are untyped in assertions */
// Fixtures shared by T-065's integration tests: a trade at INSPECTION or UNCONFIRMED_DELIVERY with the
// deadline row T-064 would have opened, and an InspectionDeps whose dispute seam is a switch.
import { randomUUID } from 'node:crypto';
import type { InspectionDeps } from '../../../../src/modules/trades/services/inspectionPorts.js';
import type { TestDatabase } from '../../../support/db.js';
import { insertRow } from '../support.js';
import { person, tradeAt, type FakeWorld } from './fulfilment-support.js';

export const H = 3_600_000;

export const inspectionDeps = (
  t: TestDatabase,
  world: FakeWorld,
  seam: { dispute: boolean } = { dispute: false },
): InspectionDeps => ({
  db: t.db(),
  now: () => world.clock.now,
  disputes: { hasOpenDispute: () => Promise.resolve(seam.dispute) },
});

export interface InspectionFixture {
  tradeId: string;
  buyer: string;
  seller: string;
  deadlineId: string;
}

/**
 * A trade at `status` with a pending deadline of the matching kind due `dueInHours` from now
 * (negative means already due), as T-064 leaves it. The seller's proof is one attached photo.
 */
export async function trade(
  t: TestDatabase,
  status: 'INSPECTION' | 'UNCONFIRMED_DELIVERY',
  dueInHours: number,
): Promise<InspectionFixture> {
  const f = await tradeAt(t, status);
  const dueAt = new Date(Date.now() + dueInHours * H).toISOString();
  const kind = status === 'INSPECTION' ? 'INSPECTION' : 'UNCONFIRMED_DELIVERY_GRACE';
  if (status === 'INSPECTION') {
    await t
      .owner()
      .query(
        `UPDATE trade.trades SET inspection_deadline_at = $2, inspection_started_at = now() WHERE id = $1`,
        [f.tradeId, dueAt],
      );
  }
  const deadlineId = await insertRow(t.owner(), 'trade.trade_deadlines', {
    trade_id: f.tradeId,
    kind,
    due_at: dueAt,
    original_due_at: dueAt,
  });
  await insertRow(t.owner(), 'trade.trade_proof_media', {
    trade_id: f.tradeId,
    file_id: randomUUID(),
    attached_by_user_id: f.seller,
  });
  return { ...f, deadlineId };
}

export const placeHold = async (t: TestDatabase, tradeId: string): Promise<string> =>
  insertRow(t.owner(), 'trade.trade_holds', {
    trade_id: tradeId,
    source: 'ADMIN',
    reason: 'frozen for review',
    placed_by_actor_type: 'STAFF',
    placed_by_actor_id: await person(t),
  });

export const releaseHold = (t: TestDatabase, holdId: string) =>
  t.owner().query(`UPDATE trade.trade_holds SET released_at = now() WHERE id = $1`, [holdId]);

export const tradeRow = async (t: TestDatabase, id: string) =>
  (await t.owner().query(`SELECT * FROM trade.trades WHERE id = $1`, [id])).rows[0];

export const deadlineRow = async (t: TestDatabase, id: string) =>
  (await t.owner().query(`SELECT * FROM trade.trade_deadlines WHERE id = $1`, [id])).rows[0];

export const stateChanges = async (t: TestDatabase, tradeId: string, action: string) =>
  (
    await t
      .owner()
      .query(`SELECT * FROM trade.trade_state_changes WHERE trade_id = $1 AND action = $2`, [tradeId, action])
  ).rows;
