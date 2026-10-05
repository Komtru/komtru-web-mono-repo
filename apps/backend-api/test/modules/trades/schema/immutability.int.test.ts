// What a trade may never be talked out of after the fact. Every attempt here is raw SQL as
// komtru_app: these are the edits a bug, a migration script or a support tool would make.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import {
  errorMessage,
  feeSnapshotColumnValues,
  insertTrade,
  insertUser,
  sqlState,
  testTradeCode,
} from '../support.js';

describe.runIf(infraEnabled)('immutable trade columns', () => {
  const t = useTestDatabase();

  const aTrade = async (overrides: Record<string, unknown> = {}) => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    return { buyer, seller, id: await insertTrade(t.app(), { buyer, seller }, overrides) };
  };

  const set = (id: string, assignment: string, value: unknown) =>
    t.app().query(`UPDATE trade.trades SET ${assignment} WHERE id = $1`, [id, value]);

  it('refuses to change a trade code', async () => {
    const { id } = await aTrade();
    expect(await sqlState(set(id, 'trade_code = $2', testTradeCode()))).toBe('KT011');
  });

  it('refuses to change the initiator role', async () => {
    const { id } = await aTrade();
    expect(await sqlState(set(id, 'initiator_role = $2', 'SELLER'))).toBe('KT011');
  });

  it('names the column it refused', async () => {
    const { id } = await aTrade();
    expect(await errorMessage(set(id, 'trade_code = $2', testTradeCode()))).toContain('trade_code');
  });

  it('refuses to change a fee snapshot once written', async () => {
    const { id } = await aTrade(feeSnapshotColumnValues());
    expect(await sqlState(set(id, 'buyer_protection_fee_minor = $2', '1'))).toBe('KT011');
  });

  it('refuses to change the schedule version a trade was accepted under', async () => {
    const { id } = await aTrade(feeSnapshotColumnValues());
    expect(await sqlState(set(id, 'fee_schedule_version = $2', '2026-11-01.1'))).toBe('KT011');
  });

  it('allows writing a fee snapshot onto a trade that has none', async () => {
    const { id } = await aTrade();
    const fees = feeSnapshotColumnValues();
    await expect(
      t.app().query(
        `UPDATE trade.trades
            SET fee_schedule_version = $2, item_amount_minor = $3, buyer_protection_fee_minor = $4,
                buyer_total_minor = $5, commission_minor = $6, seller_payout_minor = $7,
                fee_snapshot = $8::jsonb, fees_snapshotted_at = now()
          WHERE id = $1`,
        [
          id,
          fees.fee_schedule_version,
          fees.item_amount_minor,
          fees.buyer_protection_fee_minor,
          fees.buyer_total_minor,
          fees.commission_minor,
          fees.seller_payout_minor,
          fees.fee_snapshot,
        ],
      ),
    ).resolves.toBeTruthy();
  });

  it('refuses to rebind a buyer once bound', async () => {
    const { id } = await aTrade();
    const other = await insertUser(t.app());
    expect(await sqlState(set(id, 'buyer_user_id = $2', other))).toBe('KT011');
  });

  it('allows binding a counterparty that was only an invitation', async () => {
    const seller = await insertUser(t.app());
    const id = await insertTrade(
      t.app(),
      { seller, buyer: null, initiator: seller, role: 'SELLER' },
      { status: 'PENDING_COUNTERPARTY', counterparty_invitation_id: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a03' },
    );
    const buyer = await insertUser(t.app());
    await expect(set(id, 'buyer_user_id = $2', buyer)).resolves.toBeTruthy();
  });

  it('refuses to shorten an inspection window', async () => {
    const { id } = await aTrade();
    expect(await sqlState(set(id, 'inspection_window_hours = $2', 24))).toBe('KT011');
  });

  it('allows extending an inspection window (BEI1)', async () => {
    const { id } = await aTrade();
    await expect(set(id, 'inspection_window_hours = $2', 96)).resolves.toBeTruthy();
  });
});
