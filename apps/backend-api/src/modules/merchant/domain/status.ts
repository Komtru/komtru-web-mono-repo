// The application's status machine (T-055). Pure, so the transition table is tested without a database
// and the services have one place that answers "may it move from here to there".
export const MERCHANT_APPLICATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
] as const;
export type MerchantApplicationStatus = (typeof MERCHANT_APPLICATION_STATUSES)[number];

/**
 * An application in one of these still has work in it, and a person may hold at most one of them (the
 * partial unique index in migration 0050 is built from this same list). APPROVED and REJECTED are
 * decisions: a rejected applicant may apply again, and an approved one has nothing left to apply for.
 */
export const LIVE_STATUSES = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED'] as const;

export const isLive = (status: MerchantApplicationStatus): boolean =>
  (LIVE_STATUSES as readonly string[]).includes(status);

const NEXT: Record<MerchantApplicationStatus, readonly MerchantApplicationStatus[]> = {
  DRAFT: ['SUBMITTED'],
  // A decision may be taken straight from SUBMITTED: taking the case (IN_REVIEW) is the usual way in,
  // but a decision is already an act of review and must not need a second click to be legal.
  SUBMITTED: ['IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'],
  IN_REVIEW: ['CHANGES_REQUESTED', 'APPROVED', 'REJECTED'],
  CHANGES_REQUESTED: ['SUBMITTED'],
  APPROVED: [],
  REJECTED: [],
};

export const canTransition = (from: MerchantApplicationStatus, to: MerchantApplicationStatus): boolean =>
  NEXT[from].includes(to);
