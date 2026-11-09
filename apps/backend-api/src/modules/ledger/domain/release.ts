// Releasing a trade's escrow (T-074), the pure half: what a settlement is made of and what has to
// be true of it before anything is written. No I/O.
//
// Every amount arrives already computed, from the trade's fee snapshot (design §6.5, T-047). This
// module computes no fee and reads no rate: what it does is re-check that the amounts it was handed
// add up, and turn them into journal lines. A snapshot that does not add up is refused, not repaired.
//
// The one thing to get right here is WHICH liability the item comes out of. T-072 split funding
// across two accounts — `USER_ESCROW_LIABILITY<trade>` for the item and
// `BUYER_PROTECTION_FEE_LIABILITY<trade>` for the buyer protection fee — so the escrow liability's
// balance is exactly what the buyer could still get back on the item. The release debit against it
// is therefore the ITEM, not the buyer total. Debiting the total would overdraw it by the fee and
// leave the fee liability standing for ever, and the balance invariant would NOT catch it: the
// posting still balances line for line. Only the escrow balance check in the service catches that,
// which is why the service reads the balance rather than trusting this file.
import { uuidSchema, type Kobo } from '@komtru/shared-types';
import { DEFAULT_CURRENCY, normaliseAccountRef, type AccountRef } from './accounts.js';
import type { JournalLineInput } from './journal.js';

/**
 * The journal key for settling one trade's escrow: `trade:<id>:release` (T-070's convention —
 * namespaced by the thing being replayed, not by the attempt).
 *
 * A dispute split (T-080) uses the SAME key deliberately. A trade's escrow is settled once, by one
 * journal, whichever path settles it, so a split arriving after a release — or two resolutions
 * disagreeing — is an `IdempotencyKeyConflictError` out of `postJournal` rather than a second
 * posting that pays the item twice.
 */
export const releaseIdempotencyKey = (tradeId: string): string =>
  `trade:${uuidSchema.parse(tradeId)}:release`;

/** The two accounts a settlement credits by name: the trade's escrow and the seller's payable. */
export interface ReleaseParties {
  tradeId: string;
  sellerUserId: string;
}

/** The trade's fee-snapshot columns, as the trades read port hands them over. */
export interface TradeReleaseSnapshot {
  tradeId: string;
  currency: string;
  feeScheduleVersion: string | null;
  itemAmountMinor: Kobo | null;
  buyerProtectionFeeMinor: Kobo | null;
  commissionMinor: Kobo | null;
  sellerProceedsMinor: Kobo | null;
  /** Q4's refund treatment as it stood at acceptance, from the stored snapshot's `terms`. */
  refundableOnFullRefund: boolean | null;
}

export interface ReleaseAmounts {
  currency: string;
  feeScheduleVersion: string;
  /** What is escrowed, and so what the escrow liability holds. */
  itemAmountMinor: Kobo;
  buyerProtectionFeeMinor: Kobo;
  commissionMinor: Kobo;
  /** The item minus the commission: what the seller is owed. */
  sellerProceedsMinor: Kobo;
  refundableOnFullRefund: boolean;
}

export class ReleaseSnapshotError extends Error {
  readonly code = 'RELEASE_SNAPSHOT_INVALID';
  constructor(readonly detail: string) {
    super(`The trade's escrow cannot be released from its fee snapshot: ${detail}`);
    this.name = 'ReleaseSnapshotError';
  }
}

export class ReleaseSplitError extends Error {
  readonly code = 'RELEASE_SPLIT_INVALID';
  constructor(readonly detail: string) {
    super(`The dispute split does not describe the escrowed money: ${detail}`);
    this.name = 'ReleaseSplitError';
  }
}

const checkAmounts = (amounts: ReleaseAmounts): ReleaseAmounts => {
  if (amounts.currency !== DEFAULT_CURRENCY) {
    throw new ReleaseSnapshotError(`currency is ${amounts.currency}, not ${DEFAULT_CURRENCY}`);
  }
  if (!amounts.feeScheduleVersion) throw new ReleaseSnapshotError('no fee schedule version');
  if (amounts.itemAmountMinor <= 0n) throw new ReleaseSnapshotError('the item amount is not positive');
  if (amounts.buyerProtectionFeeMinor < 0n) throw new ReleaseSnapshotError('the fee is negative');
  if (amounts.commissionMinor < 0n) throw new ReleaseSnapshotError('the commission is negative');
  if (amounts.sellerProceedsMinor < 0n) throw new ReleaseSnapshotError('the seller proceeds are negative');
  if (amounts.sellerProceedsMinor + amounts.commissionMinor !== amounts.itemAmountMinor) {
    throw new ReleaseSnapshotError('the proceeds are not the item amount minus the commission');
  }
  return amounts;
};

/**
 * The amounts a release is for, straight from the snapshot. The trades table already holds the same
 * arithmetic as a CHECK (`trades_fee_snapshot_arithmetic`); this is the ledger's own re-check before
 * it moves anyone's money, so a hand-edited row or a bad backfill fails here rather than in a
 * balance report next quarter.
 */
export function releaseAmounts(snapshot: TradeReleaseSnapshot): ReleaseAmounts {
  const {
    feeScheduleVersion,
    itemAmountMinor,
    buyerProtectionFeeMinor,
    commissionMinor,
    sellerProceedsMinor,
    refundableOnFullRefund,
  } = snapshot;
  if (
    feeScheduleVersion === null ||
    itemAmountMinor === null ||
    buyerProtectionFeeMinor === null ||
    commissionMinor === null ||
    sellerProceedsMinor === null ||
    refundableOnFullRefund === null
  ) {
    throw new ReleaseSnapshotError('the trade has no complete fee snapshot');
  }
  return checkAmounts({
    currency: snapshot.currency,
    feeScheduleVersion,
    itemAmountMinor,
    buyerProtectionFeeMinor,
    commissionMinor,
    sellerProceedsMinor,
    refundableOnFullRefund,
  });
}

/**
 * A line, or nothing at all when the amount is zero. A ledger line is strictly positive
 * (`journalLineSchema`), and a zero-commission trade — which is every trade under Q14's default —
 * must produce a journal without a commission line rather than one the schema rejects.
 *
 * The ref is normalised here, so a uuid that arrived upper-case from a path parameter or a provider
 * payload names the same account as its lower-case form, and a malformed one is a loud failure at
 * the posting site rather than a quiet second account.
 */
const line = (account: AccountRef, direction: 'DEBIT' | 'CREDIT', amountMinor: Kobo): JournalLineInput[] =>
  amountMinor > 0n ? [{ account: normaliseAccountRef(account), direction, amountMinor }] : [];

/**
 * The journal for a normal release (M8 §4 step 2, with T-072's fee account):
 *
 *   DEBIT  USER_ESCROW_LIABILITY(trade)          item
 *   CREDIT USER_PAYABLE(seller)                  item − commission
 *   CREDIT PLATFORM_FEE_REVENUE                  commission
 *   DEBIT  BUYER_PROTECTION_FEE_LIABILITY(trade) fee
 *   CREDIT BUYER_PROTECTION_FEE_REVENUE          fee
 *
 * The fee leg is the only place the buyer protection fee becomes revenue: it is unearned from
 * funding until here, which is why it sat in a liability and not in revenue all along.
 */
export function releaseJournalLines(parties: ReleaseParties, amounts: ReleaseAmounts): JournalLineInput[] {
  const at = checkAmounts(amounts);
  return [
    ...line({ type: 'USER_ESCROW_LIABILITY', tradeId: parties.tradeId }, 'DEBIT', at.itemAmountMinor),
    ...line({ type: 'USER_PAYABLE', ownerUserId: parties.sellerUserId }, 'CREDIT', at.sellerProceedsMinor),
    ...line({ type: 'PLATFORM_FEE_REVENUE' }, 'CREDIT', at.commissionMinor),
    ...feeRecognitionLines(parties.tradeId, at.buyerProtectionFeeMinor),
  ];
}

/** The fee earned: off its liability and into revenue. T-074 is the only place this happens. */
export const feeRecognitionLines = (tradeId: string, amountMinor: Kobo): JournalLineInput[] => [
  ...line({ type: 'BUYER_PROTECTION_FEE_LIABILITY', tradeId }, 'DEBIT', amountMinor),
  ...line({ type: 'BUYER_PROTECTION_FEE_REVENUE' }, 'CREDIT', amountMinor),
];

/**
 * Escrowed item money going back to the buyer: off the trade's escrow liability and back into the
 * pool it was funded from (M8 §4, "same trade, refunded instead"). The provider-side refund that
 * actually moves the cash is T-075's; this is the ledger's half, and the dispute split composes it.
 */
export const escrowRefundLines = (tradeId: string, amountMinor: Kobo): JournalLineInput[] => [
  ...line({ type: 'USER_ESCROW_LIABILITY', tradeId }, 'DEBIT', amountMinor),
  ...line({ type: 'PLATFORM_ESCROW_POOL' }, 'CREDIT', amountMinor),
];

/**
 * The protection fee going back to the buyer instead of being earned (design §12 Q4). The fee is a
 * balance to discharge, never a number to subtract: a trade that ends with a non-zero fee liability
 * is a reconciliation finding (T-076), so every settlement path drives it to zero one way or the
 * other. T-075 reuses this for a full refund outside a dispute.
 */
export const feeRefundLines = (tradeId: string, amountMinor: Kobo): JournalLineInput[] => [
  ...line({ type: 'BUYER_PROTECTION_FEE_LIABILITY', tradeId }, 'DEBIT', amountMinor),
  ...line({ type: 'PLATFORM_ESCROW_POOL' }, 'CREDIT', amountMinor),
];

/** What becomes of the buyer protection fee when a dispute splits the item. */
export type FeeTreatment = 'RECOGNISE' | 'REFUND';

/**
 * Design §12 Q4's default: *"refunded on every full refund; retained on partial dispute outcomes"*.
 * Read from the trade's own snapshot, because Q4's treatment is the one in force when the trade was
 * accepted, not the one in force when the dispute is decided.
 */
export const feeTreatmentForSplit = (amounts: ReleaseAmounts, refundToBuyerMinor: Kobo): FeeTreatment =>
  refundToBuyerMinor === amounts.itemAmountMinor && amounts.refundableOnFullRefund ? 'REFUND' : 'RECOGNISE';

/**
 * How T-080 divides the escrowed item. The caller supplies all three amounts already computed: how
 * a commission is apportioned over a partial release is a fee rule, and no fee rule is decided in
 * this module (T-070). What the ledger owns is the check that they describe exactly the money it is
 * holding.
 */
export interface DisputeSplit {
  releaseToSellerMinor: Kobo;
  commissionMinor: Kobo;
  refundToBuyerMinor: Kobo;
  /** Defaults to `feeTreatmentForSplit`; T-080 may override it with a human's decision. */
  feeTreatment?: FeeTreatment;
}

/**
 * The split's own arithmetic check — the ticket's "second check after M3's trigger". M3 decides the
 * amounts and its trigger checks them; this refuses to post a set that does not sum to the escrowed
 * item, whatever M3 believes. The third check is the service's, against the live escrow balance.
 */
export function assertSplitSums(amounts: ReleaseAmounts, split: DisputeSplit): void {
  const shares = [split.releaseToSellerMinor, split.commissionMinor, split.refundToBuyerMinor];
  if (shares.some((share) => share < 0n)) {
    throw new ReleaseSplitError(
      `a share is negative (seller ${split.releaseToSellerMinor}, commission ${split.commissionMinor}, buyer ${split.refundToBuyerMinor})`,
    );
  }
  const total = shares.reduce((sum, share) => sum + share, 0n);
  if (total !== amounts.itemAmountMinor) {
    throw new ReleaseSplitError(
      `the shares come to ${total}, not ${amounts.itemAmountMinor}: seller ${split.releaseToSellerMinor} + commission ${split.commissionMinor} + buyer ${split.refundToBuyerMinor}`,
    );
  }
}

/**
 * One journal that both releases and refunds, for a dispute resolved with amounts (T-080). The item
 * leaves the escrow liability whole and is divided between the seller, the platform's commission and
 * the pool; the fee is discharged per the treatment.
 *
 * Release and refund are one posting rather than two because they are one decision: two postings
 * could half-commit, and the balance invariant would be satisfied by each half on its own.
 */
export function disputeSplitJournalLines(
  parties: ReleaseParties,
  amounts: ReleaseAmounts,
  split: DisputeSplit,
): JournalLineInput[] {
  const at = checkAmounts(amounts);
  assertSplitSums(at, split);
  const treatment = split.feeTreatment ?? feeTreatmentForSplit(at, split.refundToBuyerMinor);
  return [
    ...line({ type: 'USER_ESCROW_LIABILITY', tradeId: parties.tradeId }, 'DEBIT', at.itemAmountMinor),
    ...line(
      { type: 'USER_PAYABLE', ownerUserId: parties.sellerUserId },
      'CREDIT',
      split.releaseToSellerMinor,
    ),
    ...line({ type: 'PLATFORM_FEE_REVENUE' }, 'CREDIT', split.commissionMinor),
    ...line({ type: 'PLATFORM_ESCROW_POOL' }, 'CREDIT', split.refundToBuyerMinor),
    ...(treatment === 'REFUND'
      ? feeRefundLines(parties.tradeId, at.buyerProtectionFeeMinor)
      : feeRecognitionLines(parties.tradeId, at.buyerProtectionFeeMinor)),
  ];
}
