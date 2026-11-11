// What post-funding cancellation publishes (T-066), through the transactional outbox in the
// transaction that made it true. The refund itself is asked for with T-064's
// `trades.refund.requested`, so the ledger has one intake; these two are for the people involved —
// CR2's "the buyer wants to cancel" and the buyer hearing the seller's answer.
import { defineEvent, tradeCodeSchema, uuidSchema } from '@komtru/shared-types';
import { z } from 'zod';

/** CR1's reasons: the buyer's. */
export const BUYER_CANCELLATION_REASONS = ['CHANGED_MIND', 'FOUND_CHEAPER', 'ORDERED_BY_MISTAKE'] as const;
/** SC1's reasons: the seller's. */
export const SELLER_CANCELLATION_REASONS = [
  'OUT_OF_STOCK',
  'WRONG_PRICE',
  'CANNOT_MEET_TIMELINE',
  'OTHER',
] as const;

/** CR1: the buyer asked to cancel a funded trade before it shipped. The seller is asked (CR2). */
export const tradeCancellationRequestedEvent = defineEvent(
  'trades.cancellation.requested',
  1,
  z.object({
    tradeId: uuidSchema,
    tradeCode: tradeCodeSchema,
    requestId: uuidSchema,
    requestedByUserId: uuidSchema,
    reason: z.enum(BUYER_CANCELLATION_REASONS),
  }),
);

/** CR2: the seller answered. APPROVED is followed, in the same transaction, by `trades.refund.requested`. */
export const tradeCancellationRespondedEvent = defineEvent(
  'trades.cancellation.responded',
  1,
  z.object({
    tradeId: uuidSchema,
    tradeCode: tradeCodeSchema,
    requestId: uuidSchema,
    decision: z.enum(['APPROVED', 'DECLINED']),
    respondedByUserId: uuidSchema,
  }),
);
