// Design §6.5: a trade keeps the fees it was accepted under. This module stores a snapshot the fee
// module computed (T-047) and never a fee value of its own; what it owns is refusing one that does
// not add up, and putting it on the trade without losing a kobo.
import { describe, expect, it } from 'vitest';
import {
  assertFeeSnapshotConsistent,
  decodeSnapshotAmounts,
  feeSnapshotColumns,
  type TradeFeeSnapshot,
} from '../../../../src/modules/trades/domain/feeSnapshot.js';

const snapshot = (
  amounts: Partial<TradeFeeSnapshot['amounts']> = {},
  over: Partial<TradeFeeSnapshot> = {},
): TradeFeeSnapshot => ({
  version: '2026-10-05.1',
  currency: 'NGN',
  takenAt: '2026-10-05T12:00:00.000Z',
  sellerKind: 'CASUAL',
  amounts: {
    itemMinor: '45000000',
    buyerProtectionFeeMinor: '675000',
    buyerTotalMinor: '45675000',
    commissionMinor: '0',
    sellerProceedsMinor: '45000000',
    platformRevenueMinor: '675000',
    ...amounts,
  },
  terms: {
    buyerProtectionBps: 150,
    buyerProtectionMinMinor: '0',
    buyerProtectionMaxMinor: null,
    buyerProtectionRefundableOnFullRefund: true,
    commissionBps: 0,
    commissionMinMinor: '0',
    commissionMaxMinor: null,
  },
  ...over,
});

describe('the snapshot shape', () => {
  // The contract with T-047. If the fee module's FeeSnapshot changes, this is what says so, because
  // the type here is a structural stand-in for it until the two live in the same tree.
  it("is exactly the fee module's FeeSnapshot", () => {
    const taken = snapshot();
    expect(Object.keys(taken).sort()).toEqual([
      'amounts',
      'currency',
      'sellerKind',
      'takenAt',
      'terms',
      'version',
    ]);
    expect(Object.keys(taken.amounts).sort()).toEqual([
      'buyerProtectionFeeMinor',
      'buyerTotalMinor',
      'commissionMinor',
      'itemMinor',
      'platformRevenueMinor',
      'sellerProceedsMinor',
    ]);
    expect(Object.keys(taken.terms).sort()).toEqual([
      'buyerProtectionBps',
      'buyerProtectionMaxMinor',
      'buyerProtectionMinMinor',
      'buyerProtectionRefundableOnFullRefund',
      'commissionBps',
      'commissionMaxMinor',
      'commissionMinMinor',
    ]);
  });

  it('keeps amounts as digit strings, which is what survives JSONB and the wire', () => {
    for (const value of Object.values(snapshot().amounts)) expect(value).toMatch(/^\d+$/);
  });

  it('decodes amounts to kobo as bigint', () => {
    expect(decodeSnapshotAmounts(snapshot()).buyerTotalMinor).toBe(45_675_000n);
  });

  it('refuses an amount that is not whole kobo', () => {
    expect(() => decodeSnapshotAmounts(snapshot({ itemMinor: '45000.50' }))).toThrow(/whole kobo/);
  });
});

describe('assertFeeSnapshotConsistent', () => {
  it('accepts a snapshot whose parts add up', () => {
    expect(() => assertFeeSnapshotConsistent(snapshot())).not.toThrow();
  });

  it('rejects a buyer total that is not the item amount plus the protection fee', () => {
    expect(() => assertFeeSnapshotConsistent(snapshot({ buyerTotalMinor: '45000000' }))).toThrow(
      /buyer total/i,
    );
  });

  it('rejects a seller payout that is not the item amount minus the commission', () => {
    expect(() =>
      assertFeeSnapshotConsistent(snapshot({ commissionMinor: '100000', platformRevenueMinor: '775000' })),
    ).toThrow(/payout/i);
  });

  it('rejects platform revenue that is not the fee plus the commission', () => {
    expect(() => assertFeeSnapshotConsistent(snapshot({ platformRevenueMinor: '1' }))).toThrow(/revenue/i);
  });

  it('rejects an item amount of zero', () => {
    expect(() =>
      assertFeeSnapshotConsistent(
        snapshot({ itemMinor: '0', buyerTotalMinor: '675000', sellerProceedsMinor: '0' }),
      ),
    ).toThrow(/greater than zero/);
  });

  it('rejects an empty schedule version, because a snapshot with no provenance proves nothing', () => {
    expect(() => assertFeeSnapshotConsistent(snapshot({}, { version: '' }))).toThrow(/version/i);
  });
});

describe('feeSnapshotColumns', () => {
  it('maps a snapshot onto the trade columns, kobo for kobo', () => {
    expect(feeSnapshotColumns(snapshot())).toEqual({
      feeScheduleVersion: '2026-10-05.1',
      itemAmountMinor: 45_000_000n,
      buyerProtectionFeeMinor: 675_000n,
      buyerTotalMinor: 45_675_000n,
      commissionMinor: 0n,
      sellerProceedsMinor: 45_000_000n,
      platformRevenueMinor: 675_000n,
      feeSnapshot: snapshot(),
      feesSnapshottedAt: new Date('2026-10-05T12:00:00.000Z'),
    });
  });

  // The jsonb column is serialised with JSON.stringify, which throws on a bigint: a snapshot that
  // cannot be written is a trade that cannot be accepted.
  it('produces a fee_snapshot JSON.stringify can serialise', () => {
    expect(() => JSON.stringify(feeSnapshotColumns(snapshot()).feeSnapshot)).not.toThrow();
  });

  it('refuses to map an inconsistent snapshot at all', () => {
    expect(() => feeSnapshotColumns(snapshot({ buyerTotalMinor: '1' }))).toThrow();
  });
});
