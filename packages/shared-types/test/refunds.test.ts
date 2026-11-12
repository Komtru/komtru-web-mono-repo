import { describe, expect, it } from 'vitest';
import {
  BUYER_CANCELLATION_REASONS,
  CANCELLATION_REQUEST_STATUSES,
  REFUND_FEE_TREATMENTS,
  REFUND_SCOPES,
  SELLER_CANCELLATION_REASONS,
  refundStatusSchema,
  sellerCancellationReasonSchema,
} from '../src/index.js';

describe('refund and cancellation vocabulary (T-066, T-075)', () => {
  it('names the refund statuses in lifecycle order', () => {
    expect(refundStatusSchema.options).toEqual([
      'REQUESTED',
      'PROCESSING',
      'PROCESSED',
      'FAILED',
      'NEEDS_REVIEW',
    ]);
    expect(REFUND_SCOPES).toEqual(['FULL', 'PARTIAL']);
    expect(REFUND_FEE_TREATMENTS).toEqual(['REFUND', 'RECOGNISE', 'RETAIN']);
  });

  it('keeps the buyer’s reasons (CR1) and the seller’s (SC1) apart', () => {
    expect(BUYER_CANCELLATION_REASONS).toEqual(['CHANGED_MIND', 'FOUND_CHEAPER', 'ORDERED_BY_MISTAKE']);
    expect(SELLER_CANCELLATION_REASONS).toEqual([
      'OUT_OF_STOCK',
      'WRONG_PRICE',
      'CANNOT_MEET_TIMELINE',
      'OTHER',
    ]);
    for (const reason of BUYER_CANCELLATION_REASONS) {
      expect(sellerCancellationReasonSchema.safeParse(reason).success).toBe(false);
    }
  });

  it('names the cancellation request statuses', () => {
    expect(CANCELLATION_REQUEST_STATUSES).toEqual(['PENDING', 'APPROVED', 'DECLINED', 'LAPSED']);
  });
});
