// What a trade may never be talked out of after the fact. Every attempt here is raw SQL as
// komtru_app: these are the edits a bug, a migration script or a support tool would make.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import {
  driveTo,
  errorMessage,
  feeSnapshotColumnValues,
  insertTermsVersion,
  insertTrade,
  insertUser,
  sqlState,
  testTradeCode,
} from '../support.js';

describe.runIf(infraEnabled)('immutable trade columns', () => {
  const t = useTestDatabase();

  const aTrade = async (status = 'DRAFT') => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    const id = await insertTrade(t.app(), { buyer, seller });
    await driveTo(t.app(), id, status);
    return { buyer, seller, id };
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
    const { id } = await aTrade('PENDING_PAYMENT');
    expect(await sqlState(set(id, 'buyer_protection_fee_minor = $2', '1'))).toBe('KT011');
  });

  it('refuses to change the schedule version a trade was accepted under', async () => {
    const { id } = await aTrade('PENDING_PAYMENT');
    expect(await sqlState(set(id, 'fee_schedule_version = $2', '2026-11-01.1'))).toBe('KT011');
  });

  it('allows writing a fee snapshot onto a trade that has none', async () => {
    const { id } = await aTrade();
    const fees = feeSnapshotColumnValues();
    await expect(
      t.app().query(
        `UPDATE trade.trades
            SET fee_schedule_version = $2, item_amount_minor = $3, buyer_protection_fee_minor = $4,
                buyer_total_minor = $5, commission_minor = $6, seller_proceeds_minor = $7,
                platform_revenue_minor = $8, fee_snapshot = $9::jsonb, fees_snapshotted_at = now()
          WHERE id = $1`,
        [
          id,
          fees.fee_schedule_version,
          fees.item_amount_minor,
          fees.buyer_protection_fee_minor,
          fees.buyer_total_minor,
          fees.commission_minor,
          fees.seller_proceeds_minor,
          fees.platform_revenue_minor,
          fees.fee_snapshot,
        ],
      ),
    ).resolves.toBeTruthy();
  });

  it('refuses to change the delivery grace window, which no screen offers to change', async () => {
    const { id } = await aTrade();
    expect(await sqlState(set(id, 'delivery_grace_hours = $2', 12))).toBe('KT011');
    expect(await sqlState(set(id, 'delivery_grace_hours = $2', 96))).toBe('KT011');
  });

  it('refuses to repoint the accepted terms version once pinned', async () => {
    const { id, buyer } = await aTrade('PENDING_PAYMENT');
    const another = await insertTermsVersion(t.app(), id, buyer, { version_number: 2 });
    expect(await sqlState(set(id, 'accepted_terms_version_id = $2', another))).toBe('KT011');
  });

  it('refuses to wind the status revision backwards', async () => {
    const { id } = await aTrade('AWAITING_ACCEPTANCE');
    expect(await sqlState(set(id, 'status_revision = $2', 0))).toBe('KT011');
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
      { counterparty_invitation_id: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a03' },
    );
    await driveTo(t.app(), id, 'PENDING_COUNTERPARTY');
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
