// Cancelling a funded trade and refunding the buyer (T-066, T-075, F-030): the vocabulary the backend's
// refund and cancellation tables and the screens (CT1, CT2, AR1, CR1–CR3, SC1, SC2) share. The backend's
// schema declares the same lists; a test pins them together.
import { z } from 'zod';

/**
 * A refund's lifecycle. REQUESTED and PROCESSING are on their way back to the buyer's payment method;
 * PROCESSED is there; FAILED means the provider could not return it and the team will arrange it (the
 * money is held, not lost); NEEDS_REVIEW is the provider's answer not matching, held for the team.
 */
export const REFUND_STATUSES = ['REQUESTED', 'PROCESSING', 'PROCESSED', 'FAILED', 'NEEDS_REVIEW'] as const;

/** FULL is the whole trade (a cancellation); PARTIAL is part of the item (a dispute outcome). */
export const REFUND_SCOPES = ['FULL', 'PARTIAL'] as const;

/**
 * What became of the buyer protection fee: REFUND (handed back with the item, every full refund under
 * today's fee file), RECOGNISE (kept, if the trade's fee terms said so), RETAIN (a partial refund).
 */
export const REFUND_FEE_TREATMENTS = ['REFUND', 'RECOGNISE', 'RETAIN'] as const;

/** CR1: why the buyer wants to cancel. */
export const BUYER_CANCELLATION_REASONS = ['CHANGED_MIND', 'FOUND_CHEAPER', 'ORDERED_BY_MISTAKE'] as const;

/** SC1: why the seller cannot fulfil. */
export const SELLER_CANCELLATION_REASONS = [
  'OUT_OF_STOCK',
  'WRONG_PRICE',
  'CANNOT_MEET_TIMELINE',
  'OTHER',
] as const;

/**
 * A cancellation request. PENDING waits for the seller (CR2); APPROVED asked for the refund (a seller's
 * own SC1 starts here); DECLINED is the seller's no; LAPSED is a request the trade moved past unanswered.
 */
export const CANCELLATION_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'DECLINED', 'LAPSED'] as const;

export const refundStatusSchema = z.enum(REFUND_STATUSES);
export const refundScopeSchema = z.enum(REFUND_SCOPES);
export const refundFeeTreatmentSchema = z.enum(REFUND_FEE_TREATMENTS);
export const buyerCancellationReasonSchema = z.enum(BUYER_CANCELLATION_REASONS);
export const sellerCancellationReasonSchema = z.enum(SELLER_CANCELLATION_REASONS);
export const cancellationRequestStatusSchema = z.enum(CANCELLATION_REQUEST_STATUSES);

export type RefundStatus = z.infer<typeof refundStatusSchema>;
export type RefundScope = z.infer<typeof refundScopeSchema>;
export type RefundFeeTreatment = z.infer<typeof refundFeeTreatmentSchema>;
export type BuyerCancellationReason = z.infer<typeof buyerCancellationReasonSchema>;
export type SellerCancellationReason = z.infer<typeof sellerCancellationReasonSchema>;
export type CancellationRequestStatus = z.infer<typeof cancellationRequestStatusSchema>;
