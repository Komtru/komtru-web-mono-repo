// Funding a trade (T-072), the pure half: what a charge is for, how it is posted, and when a charge
// Paystack has verified may be believed. No I/O. The tables these rules write (`payment_attempts`,
// `payment_provider_webhooks`) arrive with the migration the T-072 plan describes.
//
// Every amount comes from the trade's fee snapshot (design §6.4, §6.5) and is re-checked here rather
// than recomputed: this module computes no fee, and a snapshot that does not add up is refused, not
// repaired.
import { uuidSchema, type Kobo } from '@komtru/shared-types';
import { DEFAULT_CURRENCY } from './accounts.js';
import type { JournalLineInput } from './journal.js';

/**
 * Paystack Inline's channel names for card, USSD and pay-with-transfer (V1, V2). Pay-with-transfer
 * issues a temporary account per transaction, which is what replaces the per-trade account V2 shows
 * (design C8, Q6). The order is the order the buyer sees them.
 */
export const PAYSTACK_INLINE_CHANNELS = ['card', 'ussd', 'bank_transfer'] as const;
export type PaystackInlineChannel = (typeof PAYSTACK_INLINE_CHANNELS)[number];

export const PAYMENT_ATTEMPT_STATUSES = [
  'INITIATED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'ABANDONED',
  'NEEDS_REVIEW',
] as const;
export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];

const FUNDING_REFERENCE_PREFIX = 'fund-';
const FUNDING_REFERENCE = /^fund-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * OUR reference for one payment attempt. One per attempt rather than one per trade, because a trade
 * whose first checkout was abandoned needs a second charge, and Paystack refuses a reused reference.
 * Paystack accepts only alphanumerics, `-`, `.` and `=`, so no underscore.
 */
export function fundingReference(attemptId: string): string {
  return `${FUNDING_REFERENCE_PREFIX}${uuidSchema.parse(attemptId).toLowerCase()}`;
}

export const isFundingReference = (reference: string): boolean => FUNDING_REFERENCE.test(reference);

/** The journal key for the posting of one charge: a replayed webhook reuses it and posts nothing. */
export const fundingIdempotencyKey = (reference: string): string => `charge:${reference}`;

/** The trade's fee snapshot columns, as the trades read port hands them over. */
export interface TradeFundingSnapshot {
  tradeId: string;
  currency: string;
  feeScheduleVersion: string | null;
  itemAmountMinor: Kobo | null;
  buyerProtectionFeeMinor: Kobo | null;
  buyerTotalMinor: Kobo | null;
}

export interface FundingAmounts {
  currency: string;
  feeScheduleVersion: string;
  itemAmountMinor: Kobo;
  buyerProtectionFeeMinor: Kobo;
  /** What the buyer is charged: the item plus the buyer protection fee. */
  totalMinor: Kobo;
}

export class FundingSnapshotError extends Error {
  readonly code = 'FUNDING_SNAPSHOT_INVALID';
  constructor(readonly detail: string) {
    super(`The trade cannot be funded from its fee snapshot: ${detail}`);
    this.name = 'FundingSnapshotError';
  }
}

const checkAmounts = (amounts: FundingAmounts): FundingAmounts => {
  if (amounts.currency !== DEFAULT_CURRENCY) {
    throw new FundingSnapshotError(`currency is ${amounts.currency}, not ${DEFAULT_CURRENCY}`);
  }
  if (!amounts.feeScheduleVersion) throw new FundingSnapshotError('no fee schedule version');
  if (amounts.itemAmountMinor <= 0n) throw new FundingSnapshotError('the item amount is not positive');
  if (amounts.buyerProtectionFeeMinor < 0n) throw new FundingSnapshotError('the fee is negative');
  if (amounts.totalMinor !== amounts.itemAmountMinor + amounts.buyerProtectionFeeMinor) {
    throw new FundingSnapshotError('the total is not the item amount plus the fee');
  }
  return amounts;
};

/**
 * The amounts a funding charge is for, straight from the snapshot. The database already holds the
 * same arithmetic as a CHECK (`trades_fee_snapshot_arithmetic`); this is the ledger's own re-check
 * before it asks anyone for money, so a hand-edited row fails here rather than at the provider.
 */
export function fundingAmounts(snapshot: TradeFundingSnapshot): FundingAmounts {
  const { feeScheduleVersion, itemAmountMinor, buyerProtectionFeeMinor, buyerTotalMinor } = snapshot;
  if (
    feeScheduleVersion === null ||
    itemAmountMinor === null ||
    buyerProtectionFeeMinor === null ||
    buyerTotalMinor === null
  ) {
    throw new FundingSnapshotError('the trade has no complete fee snapshot');
  }
  return checkAmounts({
    currency: snapshot.currency,
    feeScheduleVersion,
    itemAmountMinor,
    buyerProtectionFeeMinor,
    totalMinor: buyerTotalMinor,
  });
}

/**
 * Debit the escrow pool the total; credit the trade's escrow liability the item amount and, as a
 * separate line, the buyer protection fee. The fee is still owed at funding — Q4 refunds it on a full
 * refund and T-074 recognises it as revenue only at release — so it is a liability, not revenue.
 *
 * Which liability account holds the fee is an owner decision pending (T-072 plan, decision 1). The
 * chart has no fee-liability type, so the default is the trade's own escrow liability. A zero fee
 * has no line: a ledger line is strictly positive.
 */
export function fundingJournalLines(tradeId: string, amounts: FundingAmounts): JournalLineInput[] {
  const checked = checkAmounts(amounts);
  const escrow = { type: 'USER_ESCROW_LIABILITY' as const, tradeId };
  const lines: JournalLineInput[] = [
    { account: { type: 'PLATFORM_ESCROW_POOL' }, direction: 'DEBIT', amountMinor: checked.totalMinor },
    { account: escrow, direction: 'CREDIT', amountMinor: checked.itemAmountMinor },
  ];
  if (checked.buyerProtectionFeeMinor > 0n) {
    lines.push({ account: escrow, direction: 'CREDIT', amountMinor: checked.buyerProtectionFeeMinor });
  }
  return lines;
}

/** What the verify job knows about the attempt it is checking. */
export interface AttemptForVerify {
  reference: string;
  currency: string;
  amountMinor: Kobo;
  status: PaymentAttemptStatus;
}

/** `verifyCharge`'s answer (paystack/client.ts), reduced to what the decision reads. */
export interface VerifiedChargeView {
  reference: string;
  /** Paystack's own vocabulary: success, failed, abandoned, ongoing, pending, reversed, … */
  status: string;
  amountMinor: number;
  currency: string;
}

export type VerifyOutcome =
  /** Post the funding journal and mark the attempt SUCCEEDED. */
  | { kind: 'POST' }
  /** Close the attempt FAILED. */
  | { kind: 'FAILED'; reason: string }
  /** Leave the attempt open and stop retrying: the buyer has not paid yet, but still may (AB4). */
  | { kind: 'NOT_CONFIRMED'; providerStatus: string }
  /** Leave the attempt open and retry with backoff. */
  | { kind: 'PENDING'; providerStatus: string }
  /** Close the attempt NEEDS_REVIEW and post nothing: money may have moved, and not as agreed. */
  | { kind: 'NEEDS_REVIEW'; reason: string }
  /** Nothing to do: the attempt is already settled one way or the other. */
  | { kind: 'NO_OP' };

const OPEN: ReadonlySet<PaymentAttemptStatus> = new Set(['INITIATED', 'PENDING']);

/**
 * Whether a charge Paystack has verified may be posted. Never trusts the webhook (m8 §5): this runs on
 * the verify call's answer, and posts only an exact match. Anything ambiguous with money possibly
 * received — a different amount in either direction, another currency, a reversal, a success on an
 * attempt already closed — is held for review rather than guessed at (T-072 plan, decisions 2 and 3).
 */
export function assessVerifiedCharge(attempt: AttemptForVerify, verified: VerifiedChargeView): VerifyOutcome {
  if (attempt.status === 'SUCCEEDED') return { kind: 'NO_OP' };

  const status = verified.status;
  if (!OPEN.has(attempt.status)) {
    return status === 'success'
      ? { kind: 'NEEDS_REVIEW', reason: `a successful charge arrived on a ${attempt.status} attempt` }
      : { kind: 'NO_OP' };
  }

  if (verified.reference !== attempt.reference) {
    return { kind: 'NEEDS_REVIEW', reason: 'the verified reference is not the attempt’s' };
  }

  switch (status) {
    case 'success': {
      if (verified.currency !== attempt.currency) {
        return { kind: 'NEEDS_REVIEW', reason: `settled in ${verified.currency}, not ${attempt.currency}` };
      }
      if (!Number.isSafeInteger(verified.amountMinor)) {
        return { kind: 'NEEDS_REVIEW', reason: 'the verified amount is not an exact integer' };
      }
      const paid = BigInt(verified.amountMinor);
      if (paid !== attempt.amountMinor) {
        return {
          kind: 'NEEDS_REVIEW',
          reason: `${paid < attempt.amountMinor ? 'under' : 'over'}-payment: paid ${paid}, due ${attempt.amountMinor}`,
        };
      }
      return { kind: 'POST' };
    }
    case 'failed':
      return { kind: 'FAILED', reason: 'the provider reports the charge failed' };
    case 'reversed':
      return { kind: 'NEEDS_REVIEW', reason: 'the provider reports the charge reversed' };
    case 'abandoned':
      return { kind: 'NOT_CONFIRMED', providerStatus: status };
    default:
      // ongoing, pending, processing, queued, and anything Paystack adds later: not yet final.
      return { kind: 'PENDING', providerStatus: status };
  }
}

/**
 * The buyer-facing state of an attempt, derived from the row (AB3, AB4). `UNDER_REVIEW` exists so a
 * buyer whose money may have arrived is never shown AB4's "nothing has been charged".
 */
export type PaymentDisplayState =
  'AWAITING_PAYMENT' | 'VERIFYING' | 'CONFIRMED' | 'NOT_CONFIRMED' | 'UNDER_REVIEW';

export function paymentDisplayState(attempt: {
  status: PaymentAttemptStatus;
  lastProviderStatus: string | null;
}): PaymentDisplayState {
  switch (attempt.status) {
    case 'INITIATED':
      return 'AWAITING_PAYMENT';
    case 'PENDING':
      return attempt.lastProviderStatus === 'abandoned' ? 'NOT_CONFIRMED' : 'VERIFYING';
    case 'SUCCEEDED':
      return 'CONFIRMED';
    case 'FAILED':
    case 'ABANDONED':
      return 'NOT_CONFIRMED';
    case 'NEEDS_REVIEW':
      return 'UNDER_REVIEW';
  }
}
