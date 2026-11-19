// M3 D3 and D5, as a pure rule: a reviewer is never a party to the case they decide, never someone
// standing close enough to a party to be the same interest, and never — on an appeal — the person
// whose decision is being appealed.
//
// The two "shares something with a party" lists are ARGUMENTS rather than reads. T-080 asks for the
// exclusion; identity exposes no shared-device or shared-payout-instrument signal today. Writing
// the rule with the lists passed in means the rule is complete and tested now, and the day the
// signal exists only the adapter that fills the lists changes. Until then the adapter returns empty
// lists and the exclusion is inert — recorded as a parked question, not hidden.
export type ReviewerRefusal =
  'IS_A_PARTY' | 'SHARES_DEVICE' | 'SHARES_PAYOUT_INSTRUMENT' | 'ORIGINAL_REVIEWER';

export type ReviewerEligibility = { allowed: true } | { allowed: false; reason: ReviewerRefusal };

export interface ReviewerInput {
  reviewerId: string;
  buyerUserId: string;
  sellerUserId: string;
  /** Who decided it the first time; only consulted when `isAppeal`. */
  originalReviewerId: string | null;
  isAppeal: boolean;
  /** Users known to share a device with either party. Empty until identity can answer. */
  sharedDeviceUserIds: readonly string[];
  /** Users known to share a payout instrument with either party. Empty until the ledger can answer. */
  sharedPayoutUserIds: readonly string[];
}

/**
 * Checked strongest-first: being a party is the refusal that holds however the other facts land, so
 * a reviewer who is both a party and the original reviewer is told the thing that matters.
 */
export function reviewerEligibility(input: ReviewerInput): ReviewerEligibility {
  if (input.reviewerId === input.buyerUserId || input.reviewerId === input.sellerUserId) {
    return { allowed: false, reason: 'IS_A_PARTY' };
  }

  if (input.sharedDeviceUserIds.includes(input.reviewerId)) {
    return { allowed: false, reason: 'SHARES_DEVICE' };
  }

  if (input.sharedPayoutUserIds.includes(input.reviewerId)) {
    return { allowed: false, reason: 'SHARES_PAYOUT_INSTRUMENT' };
  }

  // D5's point is that nobody re-affirms their own decision. Outside an appeal the same reviewer
  // picking their own case back up is ordinary reassignment, so the rule stays off.
  if (input.isAppeal && input.originalReviewerId === input.reviewerId) {
    return { allowed: false, reason: 'ORIGINAL_REVIEWER' };
  }

  return { allowed: true };
}
