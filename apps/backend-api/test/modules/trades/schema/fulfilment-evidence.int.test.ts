/* eslint-disable @typescript-eslint/no-unsafe-member-access -- raw `pg` rows are untyped in assertions */
// Migration 0045: the self-arranged shipment evidence, extension requests and the substate column.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { constraintName, driveTo, enumLabels, insertRow, insertTrade, insertUser } from '../support.js';

describe.runIf(infraEnabled)('fulfilment evidence tables (migration 0045)', () => {
  const t = useTestDatabase();

  const fundedTrade = async () => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    const tradeId = await insertTrade(t.app(), { buyer, seller });
    await driveTo(t.owner(), tradeId, 'FUNDED');
    return { tradeId, buyer, seller };
  };

  const shipment = (tradeId: string, seller: string, overrides: Record<string, unknown> = {}) =>
    insertRow(t.app(), 'trade.self_arranged_shipments', {
      trade_id: tradeId,
      waybill_number: 'WB-123456',
      receipt_file_id: randomUUID(),
      driver_phone: '+2348031234567',
      vehicle_plate: 'ABC-123 DE',
      shipped_by_user_id: seller,
      ...overrides,
    });

  it('keeps one self-arranged shipment per trade', async () => {
    const { tradeId, seller } = await fundedTrade();
    await shipment(tradeId, seller);
    expect(await constraintName(shipment(tradeId, seller))).toBe('self_arranged_shipments_trade');
  });

  it('lets one receipt photo evidence one shipment only', async () => {
    const first = await fundedTrade();
    const second = await fundedTrade();
    const receipt = randomUUID();
    await shipment(first.tradeId, first.seller, { receipt_file_id: receipt });
    expect(await constraintName(shipment(second.tradeId, second.seller, { receipt_file_id: receipt }))).toBe(
      'self_arranged_receipt_file',
    );
  });

  it('does not let a trade with shipment evidence be deleted', async () => {
    const { tradeId, seller } = await fundedTrade();
    await shipment(tradeId, seller);
    await expect(t.owner().query(`DELETE FROM trade.trades WHERE id = $1`, [tradeId])).rejects.toThrow();
  });

  it('refuses a phone that is not E.164, a short waybill and a long plate', async () => {
    const { tradeId, seller } = await fundedTrade();
    expect(await constraintName(shipment(tradeId, seller, { driver_phone: '08031234567' }))).toBe(
      'self_arranged_phone_e164',
    );
    expect(await constraintName(shipment(tradeId, seller, { waybill_number: 'ab' }))).toBe(
      'self_arranged_waybill_length',
    );
    expect(await constraintName(shipment(tradeId, seller, { vehicle_plate: 'X'.repeat(15) }))).toBe(
      'self_arranged_plate_length',
    );
  });

  it('is append-only: the evidence cannot be edited or deleted, even by the owner', async () => {
    const { tradeId, seller } = await fundedTrade();
    const id = await shipment(tradeId, seller);
    await expect(
      t
        .owner()
        .query(`UPDATE trade.self_arranged_shipments SET waybill_number = 'CHANGED' WHERE id = $1`, [id]),
    ).rejects.toThrow(/append-only|immutable|KT001|may not be/i);
    await expect(
      t.owner().query(`DELETE FROM trade.self_arranged_shipments WHERE id = $1`, [id]),
    ).rejects.toThrow();
  });

  const openDeadline = async (tradeId: string) =>
    insertRow(t.app(), 'trade.trade_deadlines', {
      trade_id: tradeId,
      kind: 'DELIVERY',
      due_at: new Date(Date.now() + 86_400_000).toISOString(),
      original_due_at: new Date(Date.now() + 86_400_000).toISOString(),
    });

  const extension = (
    tradeId: string,
    deadlineId: string,
    seller: string,
    overrides: Record<string, unknown> = {},
  ) =>
    insertRow(t.app(), 'trade.delivery_extension_requests', {
      trade_id: tradeId,
      deadline_id: deadlineId,
      requested_by_user_id: seller,
      reason: 'COURIER_PICKUP_DELAYED',
      current_due_at: new Date(Date.now() + 86_400_000).toISOString(),
      requested_due_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      ...overrides,
    });

  it('allows one pending extension request per deadline, and another once it is answered', async () => {
    const { tradeId, seller } = await fundedTrade();
    const deadlineId = await openDeadline(tradeId);
    const first = await extension(tradeId, deadlineId, seller);
    expect(await constraintName(extension(tradeId, deadlineId, seller))).toBe(
      'delivery_extension_one_pending',
    );
    await t
      .app()
      .query(
        `UPDATE trade.delivery_extension_requests SET status = 'DECLINED', responded_at = now() WHERE id = $1`,
        [first],
      );
    await expect(extension(tradeId, deadlineId, seller)).resolves.toBeTypeOf('string');
  });

  it('refuses an extension that is not later, and an answered status with no answer time', async () => {
    const { tradeId, seller } = await fundedTrade();
    const deadlineId = await openDeadline(tradeId);
    const same = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      await constraintName(
        extension(tradeId, deadlineId, seller, { current_due_at: same, requested_due_at: same }),
      ),
    ).toBe('delivery_extension_later');
    expect(await constraintName(extension(tradeId, deadlineId, seller, { status: 'ACCEPTED' }))).toBe(
      'delivery_extension_answered',
    );
  });

  it('names the substate and the extension vocabularies', async () => {
    expect(await enumLabels(t.owner(), 'fulfilment_substate')).toEqual(['AWAITING_SHIPMENT']);
    expect(await enumLabels(t.owner(), 'delivery_extension_reason')).toEqual([
      'COURIER_PICKUP_DELAYED',
      'RESTOCKING_ITEM',
      'ADDRESS_OR_LOGISTICS_ISSUE',
    ]);
    expect(await enumLabels(t.owner(), 'delivery_extension_status')).toEqual([
      'PENDING',
      'ACCEPTED',
      'DECLINED',
      'CANCELLED',
      'LAPSED',
    ]);
  });

  it('lets a funded trade carry the substate and then ship', async () => {
    const { tradeId } = await fundedTrade();
    await t
      .app()
      .query(`UPDATE trade.trades SET fulfilment_substate = 'AWAITING_SHIPMENT' WHERE id = $1`, [tradeId]);
    const { rows } = await t
      .app()
      .query(`SELECT fulfilment_substate FROM trade.trades WHERE id = $1`, [tradeId]);
    expect(rows[0].fulfilment_substate).toBe('AWAITING_SHIPMENT');
  });
});
