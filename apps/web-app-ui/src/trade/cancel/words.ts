// What the cancellation and refund screens (F-030, T-119) may say, as pure functions. Each takes only what the
// platform answered for THIS trade. Nothing here computes a money amount: the refund is the ledger's own row, and
// the fee rule (Q4) is applied there, never re-derived on a screen.
import type { PaymentDisplayState, Refund } from '@komtru/api-client';

const REASONS = {
  CHANGED_MIND: 'Changed my mind',
  FOUND_CHEAPER: 'Found it elsewhere for less',
  ORDERED_BY_MISTAKE: 'Ordered by mistake',
  OUT_OF_STOCK: 'Out of stock',
  WRONG_PRICE: 'Listed at the wrong price',
  CANNOT_MEET_TIMELINE: 'Can’t meet the delivery timeline',
  OTHER: 'Something else',
} as const;

export type CancellationReasonCode = keyof typeof REASONS;

/** The reference's words for a reason code. */
export const reasonLabel = (reason: CancellationReasonCode): string => REASONS[reason];

/** Reasons arrive typed, but a code the app has not heard of is shown as the platform wrote it rather than hidden. */
export const reasonLabelOf = (reason: string): string =>
  reason in REASONS ? REASONS[reason as CancellationReasonCode] : reason;

/** What the buyer's payment status allows on CT1. */
export type PaymentRead =
  | { state: 'not-needed' }
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'read'; displayState: PaymentDisplayState };

export type PaymentGuard = 'free' | 'confirm' | 'blocked' | 'checking' | 'unknown';

/**
 * CT1 says the trade has no payment to refund, so it first asks whether one could be on its way. A bank transfer
 * can land long after the buyer left checkout, and the platform does not stop the cancel for it, so the screen does:
 * only "the platform has no attempt" is a plain cancel; an open attempt needs the buyer's own word that nothing was
 * sent; anything that may have landed or may still land offers no cancel; an unreadable status offers none either.
 */
export function paymentGuard(read: PaymentRead): PaymentGuard {
  switch (read.state) {
    case 'not-needed':
      return 'free';
    case 'loading':
      return 'checking';
    case 'failed':
      return 'unknown';
    case 'read':
      switch (read.displayState) {
        case 'NONE':
          return 'free';
        case 'AWAITING_PAYMENT':
          return 'confirm';
        case 'VERIFYING':
        case 'CONFIRMED':
        case 'UNDER_REVIEW':
        case 'NOT_CONFIRMED':
          return 'blocked';
      }
  }
}

export type RefundStage = 'none' | 'on-its-way' | 'issued' | 'held';

/**
 * Where the trade's refund stands, from the newest refund row (the platform lists newest first). Only a
 * `PROCESSED` refund is "issued"; a trade can be `CANCELLED_REFUNDED` while the money is still moving, or held.
 */
export function refundStage(refunds: readonly Refund[]): { stage: RefundStage; refund: Refund | undefined } {
  const refund = refunds[0];
  if (refund === undefined) return { stage: 'none', refund };
  switch (refund.status) {
    case 'REQUESTED':
    case 'PROCESSING':
      return { stage: 'on-its-way', refund };
    case 'PROCESSED':
      return { stage: 'issued', refund };
    case 'FAILED':
    case 'NEEDS_REVIEW':
      return { stage: 'held', refund };
  }
}

/** What the platform did with the buyer protection fee on this refund. */
export const feeTreatmentWords = (treatment: Refund['buyerProtectionFeeTreatment']): string =>
  treatment === 'REFUND' ? 'Returned with your refund' : 'Kept by Komtru';
