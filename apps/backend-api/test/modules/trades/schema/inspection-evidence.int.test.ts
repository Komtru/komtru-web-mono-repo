/* eslint-disable @typescript-eslint/no-unsafe-member-access -- raw `pg` rows are untyped in assertions */
// Migration 0046: the inspection extension requests (BEI1) and the Z5 acknowledgement.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { constraintName, driveTo, enumLabels, insertRow, insertTrade, insertUser } from '../support.js';

const DAY = 86_400_000;

describe.runIf(infraEnabled)('inspection evidence tables (migration 0046)', () => {
  const t = useTestDatabase();

  const inspectionTrade = async () => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    const tradeId = await insertTrade(t.app(), { buyer, seller });
    await driveTo(t.owner(), tradeId, 'INSPECTION');
    const deadlineId = await insertRow(t.app(), 'trade.trade_deadlines', {
      trade_id: tradeId,
      kind: 'INSPECTION',
      due_at: new Date(Date.now() + DAY).toISOString(),
      original_due_at: new Date(Date.now() + DAY).toISOString(),
    });
    return { tradeId, buyer, seller, deadlineId };
  };

  const request = (
    f: { tradeId: string; buyer: string; deadlineId: string },
    overrides: Record<string, unknown> = {},
  ) =>
    insertRow(t.app(), 'trade.inspection_extension_requests', {
      trade_id: f.tradeId,
      deadline_id: f.deadlineId,
      requested_by_user_id: f.buyer,
      extra_hours: 24,
      current_due_at: new Date(Date.now() + DAY).toISOString(),
      requested_due_at: new Date(Date.now() + 2 * DAY).toISOString(),
      ...overrides,
    });

  const acknowledgement = (f: { tradeId: string; buyer: string }, overrides: Record<string, unknown> = {}) =>
    insertRow(t.app(), 'trade.inspection_acknowledgements', {
      trade_id: f.tradeId,
      buyer_user_id: f.buyer,
      statement_code: 'RELEASE_IS_FINAL_V1',
      ...overrides,
    });

  it('allows one request per inspection deadline, ever, even after it was answered', async () => {
    const f = await inspectionTrade();
    const first = await request(f);
    expect(await constraintName(request(f))).toBe('inspection_extension_once');
    await t
      .app()
      .query(
        `UPDATE trade.inspection_extension_requests SET status = 'DECLINED', responded_at = now() WHERE id = $1`,
        [first],
      );
    expect(await constraintName(request(f))).toBe('inspection_extension_once');
  });

  it('refuses hours that are not positive, a date that is not later, and an answer with no time', async () => {
    const f = await inspectionTrade();
    expect(await constraintName(request(f, { extra_hours: 0 }))).toBe('inspection_extension_hours_positive');
    const same = new Date(Date.now() + DAY).toISOString();
    expect(await constraintName(request(f, { current_due_at: same, requested_due_at: same }))).toBe(
      'inspection_extension_later',
    );
    expect(await constraintName(request(f, { status: 'ACCEPTED' }))).toBe('inspection_extension_answered');
  });

  it('names the extension vocabulary', async () => {
    expect(await enumLabels(t.owner(), 'inspection_extension_status')).toEqual([
      'PENDING',
      'ACCEPTED',
      'DECLINED',
      'CANCELLED',
      'LAPSED',
    ]);
  });

  it('keeps one acknowledgement per trade', async () => {
    const f = await inspectionTrade();
    await acknowledgement(f);
    expect(await constraintName(acknowledgement(f))).toBe('inspection_acknowledgements_trade');
  });

  it('is append-only: an acknowledgement cannot be edited or deleted, even by the owner', async () => {
    const f = await inspectionTrade();
    const id = await acknowledgement(f);
    await expect(
      t
        .owner()
        .query(`UPDATE trade.inspection_acknowledgements SET statement_code = 'X' WHERE id = $1`, [id]),
    ).rejects.toThrow();
    await expect(
      t.owner().query(`DELETE FROM trade.inspection_acknowledgements WHERE id = $1`, [id]),
    ).rejects.toThrow();
    await expect(t.owner().query(`DELETE FROM trade.trades WHERE id = $1`, [f.tradeId])).rejects.toThrow();
  });
});
