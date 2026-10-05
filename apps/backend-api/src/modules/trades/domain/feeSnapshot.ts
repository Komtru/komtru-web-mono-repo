// Design §6.5: when a trade's terms are accepted, the fee schedule version and the computed amounts
// are stored on the trade, so the buyer sees the exact total before funding and a later edit to
// config/fees.yaml never restates an open trade's maths. Every ledger posting uses this snapshot.
//
// No fee rate or amount appears in this module. `snapshotFees({ itemMinor, sellerKind })` in the fee
// module (T-047) returns the shape below, computed by `computeTradeFees` from the loaded file, with
// `scheduleVersion` the file's `version` and every amount whole kobo. What this file owns is
// refusing a snapshot that does not add up before it reaches the trade — the database re-checks the
// same two identities (trades_fee_snapshot_arithmetic), because the money columns are the ones a
// payout is computed from.
import type { Kobo } from '@komtru/shared-types';

export interface TradeFeeSnapshot {
  /** The fee file's `version`, e.g. `2026-10-05.1`. Git history is the audit trail behind it. */
  scheduleVersion: string;
  /** Which commission applied: a casual seller's or a certified merchant's (§6.5). */
  sellerKind: 'CASUAL' | 'MERCHANT';
  itemMinor: Kobo;
  /** Paid by the buyer on top of the item price (HTML V1, conflict C10). */
  buyerProtectionFeeMinor: Kobo;
  buyerTotalMinor: Kobo;
  /** The platform's cut from the seller's proceeds at release. */
  commissionMinor: Kobo;
  sellerPayoutMinor: Kobo;
  /** Every line the fee module computed, kobo as decimal strings, for display and for audit. */
  breakdown: Record<string, string>;
}

export function assertFeeSnapshotConsistent(snapshot: TradeFeeSnapshot): void {
  if (!snapshot.scheduleVersion) {
    throw new RangeError('A fee snapshot must name the schedule version it was computed from');
  }
  if (snapshot.itemMinor <= 0n) throw new RangeError('A trade amount must be greater than zero');
  if (snapshot.buyerProtectionFeeMinor < 0n || snapshot.commissionMinor < 0n) {
    throw new RangeError('A fee is never negative');
  }
  if (snapshot.buyerTotalMinor !== snapshot.itemMinor + snapshot.buyerProtectionFeeMinor) {
    throw new RangeError('The buyer total must be the item amount plus the buyer protection fee');
  }
  if (snapshot.sellerPayoutMinor !== snapshot.itemMinor - snapshot.commissionMinor) {
    throw new RangeError('The seller payout must be the item amount minus the commission');
  }
  if (snapshot.sellerPayoutMinor < 0n) throw new RangeError('A commission cannot exceed the item amount');
}

export interface TradeFeeColumns {
  feeScheduleVersion: string;
  itemAmountMinor: Kobo;
  buyerProtectionFeeMinor: Kobo;
  buyerTotalMinor: Kobo;
  commissionMinor: Kobo;
  sellerPayoutMinor: Kobo;
  feeSnapshot: TradeFeeSnapshot & { breakdown: Record<string, string> };
  feesSnapshottedAt: Date;
}

/** The eight columns, written together in the acceptance transition's UPDATE. */
export function feeSnapshotColumns(snapshot: TradeFeeSnapshot, at: Date = new Date()): TradeFeeColumns {
  assertFeeSnapshotConsistent(snapshot);
  return {
    feeScheduleVersion: snapshot.scheduleVersion,
    itemAmountMinor: snapshot.itemMinor,
    buyerProtectionFeeMinor: snapshot.buyerProtectionFeeMinor,
    buyerTotalMinor: snapshot.buyerTotalMinor,
    commissionMinor: snapshot.commissionMinor,
    sellerPayoutMinor: snapshot.sellerPayoutMinor,
    feeSnapshot: snapshot,
    feesSnapshottedAt: at,
  };
}
