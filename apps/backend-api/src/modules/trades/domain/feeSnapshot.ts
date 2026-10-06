// Design §6.5: when a trade's terms are accepted, the fee schedule version and the computed amounts
// are stored on the trade, so the buyer sees the exact total before funding and a later edit to
// config/fees.yaml never restates an open trade's maths. Every ledger posting uses this snapshot.
//
// No fee rate or amount appears in this module. The snapshot is produced by `snapshotFees(itemMinor,
// sellerKind, takenAt?)` in the config module (T-047) and arrives here whole; what this file owns is
// putting it on the trade without losing a kobo, and refusing one that does not add up.
//
// `TradeFeeSnapshot` is `FeeSnapshot` from @komtru/shared-types, declared structurally because T-047
// landed on main after this branch was cut. It must become a re-export of that type the moment the
// two are together — the shape test in fee-snapshot.test.ts is what fails if they drift apart.
import type { Kobo } from '@komtru/shared-types';

export type SellerKind = 'CASUAL' | 'MERCHANT';

/** Amounts are decimal digit strings: this is stored as JSONB and a JSON number loses kobo past 2^53. */
export interface TradeFeeSnapshot {
  /** The `version` of config/fees.yaml these amounts came from. */
  version: string;
  currency: 'NGN';
  /** ISO-8601 instant the snapshot was taken, so an audit can line it up with git history. */
  takenAt: string;
  sellerKind: SellerKind;
  amounts: {
    itemMinor: string;
    buyerProtectionFeeMinor: string;
    buyerTotalMinor: string;
    commissionMinor: string;
    sellerProceedsMinor: string;
    platformRevenueMinor: string;
  };
  terms: {
    buyerProtectionBps: number;
    buyerProtectionMinMinor: string;
    buyerProtectionMaxMinor: string | null;
    /** Q4's refund treatment as it stood at acceptance, not as it stands at the refund. */
    buyerProtectionRefundableOnFullRefund: boolean;
    commissionBps: number;
    commissionMinMinor: string;
    commissionMaxMinor: string | null;
  };
}

export type SnapshotAmount = keyof TradeFeeSnapshot['amounts'];

const AMOUNT_KEYS: readonly SnapshotAmount[] = [
  'itemMinor',
  'buyerProtectionFeeMinor',
  'buyerTotalMinor',
  'commissionMinor',
  'sellerProceedsMinor',
  'platformRevenueMinor',
];

const DIGITS = /^\d{1,19}$/;

/** The amounts as kobo. Throws rather than returning NaN-by-another-name on a hand-edited row. */
export function decodeSnapshotAmounts(snapshot: TradeFeeSnapshot): Record<SnapshotAmount, Kobo> {
  const decoded = {} as Record<SnapshotAmount, Kobo>;
  for (const key of AMOUNT_KEYS) {
    const value = snapshot.amounts[key];
    if (!DIGITS.test(value)) {
      throw new RangeError(`A fee snapshot amount must be whole kobo as digits; ${key} is "${value}"`);
    }
    decoded[key] = BigInt(value);
  }
  return decoded;
}

/**
 * The trade's own re-check of a snapshot it is about to freeze. The calculator already guarantees
 * these identities; this is the last place to catch a snapshot that reached the trade by some other
 * route — a backfill, a replayed request, a future caller that built one by hand — before the
 * database's CHECK constraints see the same arithmetic from the columns.
 */
export function assertFeeSnapshotConsistent(snapshot: TradeFeeSnapshot): Record<SnapshotAmount, Kobo> {
  if (!snapshot.version) {
    throw new RangeError('A fee snapshot must name the schedule version it was computed from');
  }
  if (snapshot.currency !== 'NGN') throw new RangeError('A trade is priced in naira');
  const at = decodeSnapshotAmounts(snapshot);
  if (at.itemMinor <= 0n) throw new RangeError('A trade amount must be greater than zero');
  if (at.buyerTotalMinor !== at.itemMinor + at.buyerProtectionFeeMinor) {
    throw new RangeError('The buyer total must be the item amount plus the buyer protection fee');
  }
  if (at.sellerProceedsMinor !== at.itemMinor - at.commissionMinor) {
    throw new RangeError('The seller payout must be the item amount minus the commission');
  }
  if (at.platformRevenueMinor !== at.buyerProtectionFeeMinor + at.commissionMinor) {
    throw new RangeError('Platform revenue must be the buyer protection fee plus the commission');
  }
  return at;
}

export interface TradeFeeColumns {
  feeScheduleVersion: string;
  itemAmountMinor: Kobo;
  buyerProtectionFeeMinor: Kobo;
  buyerTotalMinor: Kobo;
  commissionMinor: Kobo;
  sellerProceedsMinor: Kobo;
  platformRevenueMinor: Kobo;
  /** Stored verbatim. Amounts stay strings here: drizzle serialises JSONB with JSON.stringify,
   * which throws on a bigint, and a JSON number would lose kobo even if it did not. */
  feeSnapshot: TradeFeeSnapshot;
  feesSnapshottedAt: Date;
}

/** The nine columns, written in the acceptance transition's own UPDATE. */
export function feeSnapshotColumns(snapshot: TradeFeeSnapshot): TradeFeeColumns {
  const at = assertFeeSnapshotConsistent(snapshot);
  return {
    feeScheduleVersion: snapshot.version,
    itemAmountMinor: at.itemMinor,
    buyerProtectionFeeMinor: at.buyerProtectionFeeMinor,
    buyerTotalMinor: at.buyerTotalMinor,
    commissionMinor: at.commissionMinor,
    sellerProceedsMinor: at.sellerProceedsMinor,
    platformRevenueMinor: at.platformRevenueMinor,
    feeSnapshot: snapshot,
    feesSnapshottedAt: new Date(snapshot.takenAt),
  };
}
