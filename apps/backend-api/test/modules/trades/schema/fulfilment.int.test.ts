// The concurrency guards that keep a trade from being double-funded, double-held or double-swept.
// Every one is a partial unique index: the second writer loses in the database, not in whichever
// job happened to read first. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { constraintName, insertRow, insertTrade, insertUser } from '../support.js';

describe.runIf(infraEnabled)('trade fulfilment and escrow guards', () => {
  const t = useTestDatabase();

  const aTrade = async () => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    return insertTrade(t.app(), { buyer, seller });
  };

  const escrowRequest = (tradeId: string, overrides: Record<string, unknown> = {}) =>
    insertRow(t.app(), 'trade.escrow_action_requests', {
      trade_id: tradeId,
      action: 'RELEASE',
      amount_minor: '45000000',
      ...overrides,
    });

  it('allows at most one open escrow request per trade and action', async () => {
    const tradeId = await aTrade();
    await escrowRequest(tradeId);
    expect(await constraintName(escrowRequest(tradeId))).toBe('escrow_requests_one_open');
  });

  it('allows a new release request once the previous one completed', async () => {
    const tradeId = await aTrade();
    const first = await escrowRequest(tradeId);
    await t
      .app()
      .query(`UPDATE trade.escrow_action_requests SET status = 'COMPLETED' WHERE id = $1`, [first]);
    await expect(escrowRequest(tradeId)).resolves.toBeTypeOf('string');
  });

  it('rejects a non-positive escrow amount', async () => {
    const tradeId = await aTrade();
    expect(await constraintName(escrowRequest(tradeId, { amount_minor: '0' }))).toBe(
      'escrow_requests_amount_positive',
    );
  });

  const hold = (tradeId: string, overrides: Record<string, unknown> = {}) =>
    insertRow(t.app(), 'trade.trade_holds', {
      trade_id: tradeId,
      source: 'RISK',
      reason: 'velocity rule',
      placed_by_actor_type: 'SYSTEM',
      ...overrides,
    });

  it('allows at most one active hold per trade and source', async () => {
    const tradeId = await aTrade();
    await hold(tradeId);
    expect(await constraintName(hold(tradeId))).toBe('trade_holds_one_active');
  });

  it('allows a second hold from another source', async () => {
    const tradeId = await aTrade();
    await hold(tradeId);
    await expect(hold(tradeId, { source: 'ADMIN' })).resolves.toBeTypeOf('string');
  });

  const deadline = (tradeId: string, overrides: Record<string, unknown> = {}) => {
    const dueAt = new Date(Date.now() + 86_400_000).toISOString();
    return insertRow(t.app(), 'trade.trade_deadlines', {
      trade_id: tradeId,
      kind: 'INSPECTION',
      due_at: dueAt,
      original_due_at: dueAt,
      ...overrides,
    });
  };

  it('allows at most one pending deadline per trade and kind', async () => {
    const tradeId = await aTrade();
    await deadline(tradeId);
    expect(await constraintName(deadline(tradeId))).toBe('trade_deadlines_one_pending');
  });

  it('refuses a deadline set earlier than the one it replaced', async () => {
    const tradeId = await aTrade();
    expect(
      await constraintName(deadline(tradeId, { due_at: new Date(Date.now() - 1000).toISOString() })),
    ).toBe('trade_deadlines_never_shortened');
  });

  const signal = (tradeId: string, overrides: Record<string, unknown> = {}) =>
    insertRow(t.app(), 'trade.delivery_signals', {
      trade_id: tradeId,
      source: 'PARTNER_PORTAL',
      shipment_event_id: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a09',
      ...overrides,
    });

  it('rejects a duplicate partner delivery signal for the same shipment event', async () => {
    const tradeId = await aTrade();
    await signal(tradeId);
    expect(await constraintName(signal(tradeId))).toBe('delivery_signals_shipment_event');
  });

  it('allows two self-reports, which carry no shipment event', async () => {
    const tradeId = await aTrade();
    const selfReport = { source: 'SELLER_SELF_REPORT', shipment_event_id: null };
    await signal(tradeId, selfReport);
    await expect(signal(tradeId, selfReport)).resolves.toBeTypeOf('string');
  });
});
