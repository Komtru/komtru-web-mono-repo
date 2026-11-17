// Migration 0051: the evidence parties add to a live trade (F-028, CWT-S13).
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { constraintName, enumLabels, insertRow, insertTrade, insertUser } from '../support.js';

describe.runIf(infraEnabled)('trade evidence media (migration 0051)', () => {
  const t = useTestDatabase();

  const world = async () => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    const tradeId = await insertTrade(t.app(), { buyer, seller });
    return { buyer, seller, tradeId };
  };

  const row = (f: { tradeId: string; buyer: string }, overrides: Record<string, unknown> = {}) => ({
    trade_id: f.tradeId,
    file_id: randomUUID(),
    event: 'DELIVERY',
    attached_by_user_id: f.buyer,
    attached_by_role: 'BUYER',
    ...overrides,
  });

  it('names the four categories the reference offers, and not the seller proof', async () => {
    expect(await enumLabels(t.owner(), 'trade_evidence_event')).toEqual([
      'DISPATCH',
      'DELIVERY',
      'INSPECTION',
      'ISSUE',
    ]);
  });

  it('stores one row per file and refuses the same file twice, on any trade', async () => {
    const f = await world();
    const other = await world();
    const fileId = randomUUID();
    await insertRow(t.app(), 'trade.trade_evidence_media', row(f, { file_id: fileId }));
    const error = constraintName(
      insertRow(t.app(), 'trade.trade_evidence_media', row(other, { file_id: fileId })),
    );
    expect(await error).toBe('trade_evidence_media_file');
  });

  it('refuses an unknown category, and a row can be neither changed nor removed', async () => {
    const f = await world();
    await expect(
      insertRow(t.app(), 'trade.trade_evidence_media', row(f, { event: 'LISTING' })),
    ).rejects.toThrow();
    const id = await insertRow(t.app(), 'trade.trade_evidence_media', row(f));
    await expect(
      t.owner().query(`UPDATE trade.trade_evidence_media SET event = 'ISSUE' WHERE id = $1`, [id]),
    ).rejects.toThrow();
    await expect(
      t.owner().query(`DELETE FROM trade.trade_evidence_media WHERE id = $1`, [id]),
    ).rejects.toThrow();
    // Evidence outlives a request to delete its trade, as the other append-only trade records do.
    await expect(t.owner().query(`DELETE FROM trade.trades WHERE id = $1`, [f.tradeId])).rejects.toThrow();
  });
});
