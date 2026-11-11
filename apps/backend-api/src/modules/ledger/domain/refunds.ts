// Giving a buyer their money back (T-075), as pure rules: what a refund decision posts, what a failed
// refund posts back, and what the provider's own record of a refund means. No I/O.
//
// The journals (M8 §4 "same trade, refunded instead", with T-072's fee account and design §12 Q4):
//
//   decided, FULL, fee refunded    DEBIT  USER_ESCROW_LIABILITY(trade)           item
//                                  CREDIT PLATFORM_ESCROW_POOL                   item
//                                  DEBIT  BUYER_PROTECTION_FEE_LIABILITY(trade)  fee
//                                  CREDIT PLATFORM_ESCROW_POOL                   fee
//   decided, FULL, fee kept        the item legs, then the fee earned:
//                                  DEBIT  BUYER_PROTECTION_FEE_LIABILITY(trade)  fee
//                                  CREDIT BUYER_PROTECTION_FEE_REVENUE           fee
//   decided, PARTIAL               the item legs for the partial amount; the fee is left standing
//   failed                         DEBIT  PLATFORM_ESCROW_POOL                   item + fee refunded
//                                  CREDIT USER_ESCROW_LIABILITY(trade)           item
//                                  CREDIT BUYER_PROTECTION_FEE_LIABILITY(trade)  fee refunded
//
// The ledger records Kumtru's DECISION to refund immediately (M8 §7): the pool is credited the moment
// the refund is decided, and the provider call that executes it comes after. A provider `failed` means
// Paystack has put the money back in our balance (m8 §3) and the buyer still has not been paid, so the
// failure journal returns exactly the cash-out legs of the decision to where they came from: the pool
// holds it, the trade owes it. A fee earned at decision stays earned — that was not cash.
//
// Every amount arrives already computed, from the trade's frozen snapshot (design §6.5). No rate, cap
// or floor appears here; the one policy read is Q4's flag, from the snapshot, never the live file.
import { uuidSchema, type Kobo } from '@komtru/shared-types';
import { DEFAULT_CURRENCY, normaliseAccountRef, type AccountRef } from './accounts.js';
import type { JournalLineInput } from './journal.js';
import {
  escrowRefundLines,
  feeRecognitionLines,
  feeRefundLines,
  refundableOnFullRefundOf,
  type ReleaseAmounts,
} from './release.js';

const REFUND_REFERENCE = /^refund-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** OUR reference for one refund. Paystack's Refund API takes none, so it is our bookkeeping only. */
export const refundReference = (refundId: string): string =>
  `refund-${uuidSchema.parse(refundId).toLowerCase()}`;

export const isRefundReference = (reference: string): boolean => REFUND_REFERENCE.test(reference);

export type RefundJournalStage = 'decided' | 'failed';

/** `refund:<id>:<stage>`: each stage posts once, however many times it is asked. */
export const refundIdempotencyKey = (refundId: string, stage: RefundJournalStage): string =>
  `refund:${uuidSchema.parse(refundId).toLowerCase()}:${stage}`;

/** What becomes of the buyer protection fee on this refund. */
export type RefundFeeTreatment = 'REFUND' | 'RECOGNISE' | 'RETAIN';

/** What is being refunded: the whole trade, or part of the escrowed item. */
export type RefundRequestScope = { scope: 'FULL' } | { scope: 'PARTIAL'; itemAmountMinor: Kobo };

export class RefundRequestError extends Error {
  readonly code = 'REFUND_REQUEST_INVALID';
  constructor(readonly detail: string) {
    super(`The refund cannot be planned: ${detail}`);
    this.name = 'RefundRequestError';
  }
}

export interface PlannedRefund {
  scope: 'FULL' | 'PARTIAL';
  /** Out of the trade's escrow liability. */
  itemAmountMinor: Kobo;
  /** Handed back to the buyer; zero unless the treatment is REFUND. */
  feeAmountMinor: Kobo;
  /** What the provider is asked to refund: item plus fee. */
  amountMinor: Kobo;
  feeTreatment: RefundFeeTreatment;
  lines: JournalLineInput[];
}

/**
 * The decision journal and the amounts behind it, from one plan. Built together on purpose (T-074's
 * rule): a refund row that says one thing while its journal says another is the hardest kind of money
 * bug to find.
 *
 * FULL: the whole snapshotted item, and the fee by Q4's flag as the trade froze it — refunded with
 * it, or recognised as earned so no liability is left standing. PARTIAL: strictly less than the item,
 * strictly more than zero, item money only; Q4 retains the fee on a partial outcome, so the fee
 * liability is left for whatever settles the rest of the trade.
 */
export function planRefund(
  tradeId: string,
  amounts: ReleaseAmounts,
  request: RefundRequestScope,
): PlannedRefund {
  if (amounts.currency !== DEFAULT_CURRENCY) {
    throw new RefundRequestError(`currency is ${amounts.currency}, not ${DEFAULT_CURRENCY}`);
  }
  if (amounts.itemAmountMinor <= 0n) throw new RefundRequestError('the item amount is not positive');
  if (amounts.buyerProtectionFeeMinor < 0n) throw new RefundRequestError('the fee is negative');

  if (request.scope === 'PARTIAL') {
    const part = request.itemAmountMinor;
    if (part <= 0n || part >= amounts.itemAmountMinor) {
      throw new RefundRequestError(
        `a partial refund must be more than 0 and less than the item ${amounts.itemAmountMinor}; got ${part}`,
      );
    }
    return {
      scope: 'PARTIAL',
      itemAmountMinor: part,
      feeAmountMinor: 0n,
      amountMinor: part,
      feeTreatment: 'RETAIN',
      lines: escrowRefundLines(tradeId, part),
    };
  }

  const fee = amounts.buyerProtectionFeeMinor;
  const refundFee = refundableOnFullRefundOf(amounts.feeSnapshot);
  const feeAmountMinor = refundFee ? fee : 0n;
  return {
    scope: 'FULL',
    itemAmountMinor: amounts.itemAmountMinor,
    feeAmountMinor,
    amountMinor: amounts.itemAmountMinor + feeAmountMinor,
    feeTreatment: refundFee ? 'REFUND' : 'RECOGNISE',
    lines: [
      ...escrowRefundLines(tradeId, amounts.itemAmountMinor),
      ...(refundFee ? feeRefundLines(tradeId, fee) : feeRecognitionLines(tradeId, fee)),
    ],
  };
}

const positiveLine = (
  account: AccountRef,
  direction: 'DEBIT' | 'CREDIT',
  amountMinor: Kobo,
): JournalLineInput[] => {
  if (amountMinor < 0n)
    throw new RefundRequestError(`a refund amount cannot be negative; got ${amountMinor}`);
  return amountMinor > 0n ? [{ account: normaliseAccountRef(account), direction, amountMinor }] : [];
};

/**
 * The provider could not refund: the cash-out legs of the decision, reversed. The pool holds the money
 * again and the trade's liabilities owe it again, so a reconciliation run sees a cancelled trade still
 * owing its buyer — which is the truth, and what a person retrying the refund starts from.
 */
export function refundFailureLines(
  tradeId: string,
  refund: { itemAmountMinor: Kobo; feeAmountMinor: Kobo },
): JournalLineInput[] {
  const total = refund.itemAmountMinor + refund.feeAmountMinor;
  return [
    ...positiveLine({ type: 'PLATFORM_ESCROW_POOL' }, 'DEBIT', total),
    ...positiveLine({ type: 'USER_ESCROW_LIABILITY', tradeId }, 'CREDIT', refund.itemAmountMinor),
    ...positiveLine({ type: 'BUYER_PROTECTION_FEE_LIABILITY', tradeId }, 'CREDIT', refund.feeAmountMinor),
  ];
}

/** What the provider's own record of a refund says, narrowed to what resolving one reads. */
export interface VerifiedRefundView {
  providerRefundId: string;
  status: string;
  amountMinor: number;
  currency: string;
}

/** A refund id the provider has no record of. Never a reason to send again — see the dispatch service. */
export class RefundNotFoundError extends Error {
  readonly code = 'REFUND_NOT_FOUND';
  constructor(readonly providerRefundId: string) {
    super(`the provider has no refund with id ${providerRefundId}`);
    this.name = 'RefundNotFoundError';
  }
}

export type RefundOutcome = 'PROCESSED' | 'FAILED' | 'PENDING';

/**
 * Paystack's refund statuses: `pending` and `processing` are on their way, `processed` reached the
 * buyer's payment method, `failed` came back to our balance (m8 §3). Anything else — a status nobody
 * has documented — is treated as still on its way, so it is asked about again and, past the age cap,
 * handed to a person. It never moves money.
 */
export function refundOutcome(providerStatus: string): RefundOutcome {
  const status = providerStatus.toLowerCase();
  if (status === 'processed') return 'PROCESSED';
  if (status === 'failed') return 'FAILED';
  return 'PENDING';
}

/** Why the provider's record is not this refund, or nothing. Amount and currency are both money. */
export function describeRefundMismatch(
  refund: { amountMinor: Kobo; currency: string; providerRefundId: string | null },
  verified: VerifiedRefundView,
): string | undefined {
  if (refund.providerRefundId && refund.providerRefundId !== verified.providerRefundId) {
    return `the provider answered for refund ${verified.providerRefundId}, not ${refund.providerRefundId}`;
  }
  if (verified.currency.toUpperCase() !== refund.currency) {
    return `the refund is in ${verified.currency}, not ${refund.currency}`;
  }
  if (!Number.isSafeInteger(verified.amountMinor) || BigInt(verified.amountMinor) !== refund.amountMinor) {
    return `the refund is for ${String(verified.amountMinor)}, not ${String(refund.amountMinor)}`;
  }
  return undefined;
}
