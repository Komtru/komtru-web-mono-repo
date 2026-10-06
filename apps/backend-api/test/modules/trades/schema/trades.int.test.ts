// The rules a trade cannot be talked out of. Every assertion names the constraint that fired, so a
// test proves which rule held rather than that something did. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import {
  ADDRESS,
  constraintName,
  driveTo,
  feeSnapshotColumnValues,
  insertRow,
  insertTrade,
  insertUser,
  testTradeCode,
  transition,
} from '../support.js';

describe.runIf(infraEnabled)('trade.trades', () => {
  const t = useTestDatabase();
  const parties = async () => ({ buyer: await insertUser(t.app()), seller: await insertUser(t.app()) });

  it('accepts a draft trade with both parties bound', async () => {
    const { buyer, seller } = await parties();
    await expect(insertTrade(t.app(), { buyer, seller })).resolves.toBeTypeOf('string');
  });

  it('rejects a trade whose buyer and seller are the same person', async () => {
    const user = await insertUser(t.app());
    expect(await constraintName(insertTrade(t.app(), { buyer: user, seller: user }))).toBe(
      'trades_parties_distinct',
    );
  });

  it('rejects an initiator who does not occupy the side they chose', async () => {
    const { buyer, seller } = await parties();
    expect(
      await constraintName(insertTrade(t.app(), { buyer, seller, initiator: seller, role: 'BUYER' })),
    ).toBe('trades_initiator_side');
  });

  // The ticket writes the code as `KMT-88213`; `tradeCodeSchema` (shared-types) treats that as the
  // forgiving *input* form and normalises it to `KMT-88213-NG`. The column stores the normalised
  // form only, so the database never holds two spellings of one code.
  it('rejects a trade code that has not been normalised to KMT-<digits>-NG', async () => {
    const { buyer, seller } = await parties();
    expect(await constraintName(insertTrade(t.app(), { buyer, seller }, { trade_code: 'KMT-88213' }))).toBe(
      'trades_code_format',
    );
  });

  it('rejects a second trade with the same code', async () => {
    const { buyer, seller } = await parties();
    const code = testTradeCode();
    await insertTrade(t.app(), { buyer, seller }, { trade_code: code });
    expect(await constraintName(insertTrade(t.app(), { buyer, seller }, { trade_code: code }))).toBe(
      'trades_trade_code_unique',
    );
  });

  it('rejects a non-positive inspection window', async () => {
    const { buyer, seller } = await parties();
    expect(
      await constraintName(insertTrade(t.app(), { buyer, seller }, { inspection_window_hours: 0 })),
    ).toBe('trades_window_positive');
  });

  it('rejects a fee snapshot that is only half written', async () => {
    const { buyer, seller } = await parties();
    expect(
      await constraintName(insertTrade(t.app(), { buyer, seller }, { fee_schedule_version: '2026-10-05.1' })),
    ).toBe('trades_fee_snapshot_complete');
  });

  it('rejects a buyer total that is not the item amount plus the protection fee', async () => {
    const { buyer, seller } = await parties();
    const fees = { ...feeSnapshotColumnValues(), buyer_total_minor: '1' };
    expect(await constraintName(insertTrade(t.app(), { buyer, seller }, fees))).toBe(
      'trades_fee_snapshot_arithmetic',
    );
  });

  it('rejects a seller payout that is not the item amount minus the commission', async () => {
    const { buyer, seller } = await parties();
    const fees = {
      ...feeSnapshotColumnValues(45_000_000n, 675_000n, 100_000n),
      seller_proceeds_minor: '45000000',
    };
    expect(await constraintName(insertTrade(t.app(), { buyer, seller }, fees))).toBe(
      'trades_fee_snapshot_arithmetic',
    );
  });

  it('rejects platform revenue that is not the fee plus the commission', async () => {
    const { buyer, seller } = await parties();
    const fees = { ...feeSnapshotColumnValues(), platform_revenue_minor: '1' };
    expect(await constraintName(insertTrade(t.app(), { buyer, seller }, fees))).toBe(
      'trades_fee_snapshot_arithmetic',
    );
  });

  it('refuses to accept a trade without pinning the terms that were agreed', async () => {
    const { buyer, seller } = await parties();
    const id = await insertTrade(t.app(), { buyer, seller });
    await driveTo(t.app(), id, 'AWAITING_ACCEPTANCE');
    expect(
      await constraintName(transition(t.app(), id, { action: 'ACCEPT', to: 'PENDING_PAYMENT', fees: true })),
    ).toBe('trades_terms_before_payment');
  });

  it('rejects accepting a trade without snapshotting its fees', async () => {
    const { buyer, seller } = await parties();
    const id = await insertTrade(t.app(), { buyer, seller });
    await driveTo(t.app(), id, 'AWAITING_ACCEPTANCE');
    expect(await constraintName(transition(t.app(), id, { action: 'ACCEPT', to: 'PENDING_PAYMENT' }))).toBe(
      'trades_fees_before_payment',
    );
  });

  it('accepts PENDING_PAYMENT once the fees are frozen', async () => {
    const { buyer, seller } = await parties();
    const id = await insertTrade(t.app(), { buyer, seller });
    await driveTo(t.app(), id, 'PENDING_PAYMENT');
    const { rows } = await t
      .app()
      .query<{ status: string }>('SELECT status FROM trade.trades WHERE id = $1', [id]);
    expect(rows[0]?.status).toBe('PENDING_PAYMENT');
  });

  it('refuses to leave PENDING_COUNTERPARTY until the counterparty is a real user', async () => {
    const seller = await insertUser(t.app());
    const id = await insertTrade(
      t.app(),
      { seller, buyer: null, initiator: seller, role: 'SELLER' },
      { counterparty_invitation_id: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a03' },
    );
    await transition(t.app(), id, { action: 'SEND', to: 'PENDING_COUNTERPARTY' });
    expect(
      await constraintName(
        transition(t.app(), id, { action: 'CLAIM_INVITATION', to: 'AWAITING_ACCEPTANCE' }),
      ),
    ).toBe('trades_parties_bound');

    // With the claimer bound in the same statement, the same transition is allowed.
    const buyer = await insertUser(t.app());
    await expect(
      transition(
        t.app(),
        id,
        { action: 'CLAIM_INVITATION', to: 'AWAITING_ACCEPTANCE' },
        { buyer_user_id: buyer },
      ),
    ).resolves.toBeTruthy();
  });

  it('accepts a PENDING_COUNTERPARTY trade whose buyer is only an invitation', async () => {
    const seller = await insertUser(t.app());
    const id = await insertTrade(
      t.app(),
      { seller, buyer: null, initiator: seller, role: 'SELLER' },
      { counterparty_invitation_id: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a03' },
    );
    await expect(driveTo(t.app(), id, 'PENDING_COUNTERPARTY')).resolves.toBeUndefined();
  });
});

describe.runIf(infraEnabled)('trade.trade_terms_versions', () => {
  const t = useTestDatabase();

  const termsFor = async (tradeId: string, proposedBy: string, overrides: Record<string, unknown> = {}) =>
    insertRow(t.app(), 'trade.trade_terms_versions', {
      trade_id: tradeId,
      version_number: 1,
      proposed_by_user_id: proposedBy,
      proposed_by_role: 'BUYER',
      item_amount_minor: '45000000',
      item_spec: JSON.stringify({ brand: 'Apple', model: 'iPhone 15' }),
      inspection_window_hours: 72,
      delivery_grace_hours: 48,
      delivery_address: JSON.stringify(ADDRESS),
      ships_from_address: JSON.stringify(ADDRESS),
      ...overrides,
    });

  const seeded = async () => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    return { buyer, tradeId: await insertTrade(t.app(), { buyer, seller }) };
  };

  it('accepts a first version with both address snapshots', async () => {
    const { tradeId, buyer } = await seeded();
    await expect(termsFor(tradeId, buyer)).resolves.toBeTypeOf('string');
  });

  it('rejects two terms versions with the same number on one trade', async () => {
    const { tradeId, buyer } = await seeded();
    await termsFor(tradeId, buyer);
    expect(await constraintName(termsFor(tradeId, buyer))).toBe('trade_terms_versions_trade_version');
  });

  it('rejects a ships-from address missing city_id', async () => {
    const { tradeId, buyer } = await seeded();
    const { city_id: _omitted, ...incomplete } = ADDRESS;
    expect(
      await constraintName(termsFor(tradeId, buyer, { ships_from_address: JSON.stringify(incomplete) })),
    ).toBe('trade_terms_ships_from_address_shape');
  });

  it('rejects a non-positive item amount', async () => {
    const { tradeId, buyer } = await seeded();
    expect(await constraintName(termsFor(tradeId, buyer, { item_amount_minor: '0' }))).toBe(
      'trade_terms_amount_positive',
    );
  });

  it('deletes terms versions with their trade', async () => {
    const { tradeId, buyer } = await seeded();
    await termsFor(tradeId, buyer);
    await t.app().query('DELETE FROM trade.trades WHERE id = $1', [tradeId]);
    const { rows } = await t.app().query('SELECT 1 FROM trade.trade_terms_versions');
    expect(rows).toHaveLength(0);
  });
});
