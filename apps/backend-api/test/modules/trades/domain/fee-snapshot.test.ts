// Design §6.5: a trade keeps the fees it was accepted under. This module stores a snapshot computed
// by the fee module (T-047) and never a fee value of its own; what it does own is refusing an
// inconsistent snapshot before it reaches the database.
import { describe, expect, it } from 'vitest';
import {
  assertFeeSnapshotConsistent,
  feeSnapshotColumns,
  type TradeFeeSnapshot,
} from '../../../../src/modules/trades/domain/feeSnapshot.js';

const snapshot = (over: Partial<TradeFeeSnapshot> = {}): TradeFeeSnapshot => ({
  scheduleVersion: '2026-10-05.1',
  sellerKind: 'CASUAL',
  itemMinor: 45_000_000n,
  buyerProtectionFeeMinor: 675_000n,
  buyerTotalMinor: 45_675_000n,
  commissionMinor: 0n,
  sellerPayoutMinor: 45_000_000n,
  breakdown: { buyerProtectionFee: '675000' },
  ...over,
});

describe('assertFeeSnapshotConsistent', () => {
  it('accepts a snapshot whose parts add up', () => {
    expect(() => assertFeeSnapshotConsistent(snapshot())).not.toThrow();
  });

  it('rejects a buyer total that is not the item amount plus the protection fee', () => {
    expect(() => assertFeeSnapshotConsistent(snapshot({ buyerTotalMinor: 45_000_000n }))).toThrow(
      /buyer total/i,
    );
  });

  it('rejects a seller payout that is not the item amount minus the commission', () => {
    expect(() =>
      assertFeeSnapshotConsistent(snapshot({ commissionMinor: 100_000n, sellerPayoutMinor: 45_000_000n })),
    ).toThrow(/payout/i);
  });

  it('rejects a negative amount', () => {
    expect(() => assertFeeSnapshotConsistent(snapshot({ buyerProtectionFeeMinor: -1n }))).toThrow();
  });

  it('rejects an empty schedule version, because a snapshot with no provenance proves nothing', () => {
    expect(() => assertFeeSnapshotConsistent(snapshot({ scheduleVersion: '' }))).toThrow(/version/i);
  });
});

describe('feeSnapshotColumns', () => {
  it('maps a snapshot onto the trade columns, kobo for kobo', () => {
    const columns = feeSnapshotColumns(snapshot());
    expect(columns).toMatchObject({
      feeScheduleVersion: '2026-10-05.1',
      itemAmountMinor: 45_000_000n,
      buyerProtectionFeeMinor: 675_000n,
      buyerTotalMinor: 45_675_000n,
      commissionMinor: 0n,
      sellerPayoutMinor: 45_000_000n,
    });
    expect(columns.feeSnapshot).toMatchObject({ scheduleVersion: '2026-10-05.1', sellerKind: 'CASUAL' });
  });

  it('refuses to map an inconsistent snapshot at all', () => {
    expect(() => feeSnapshotColumns(snapshot({ buyerTotalMinor: 1n }))).toThrow();
  });
});
