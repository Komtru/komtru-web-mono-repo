// Design §6.3's "one identity function", which is what that ruling literally asks for: the buy block
// is a fact about an identity, not about a trade, and it is checked in six different places (design
// §6.3's list — creating a trade as buyer, being named as one, accepting as one, claiming a buyer
// invitation, cart checkout, buying from a listing). T-060 wrote it in `trades/domain/eligibility.ts`
// because identity had no service layer yet, with a note that trades must delegate rather than keep a
// second copy once there was somewhere to delegate to. This is that somewhere.
//
// It takes the capability STATUS rather than a principal, so identity can answer it from the row its
// own lookup already fetched and trades can answer it from `TradePrincipal`, with one rule between
// them.
export type CapabilityStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';

/**
 * False only while the account holds an ACTIVE MERCHANT capability.
 *
 * PENDING is not a block: an application under review has not been approved and the applicant is
 * still an ordinary buyer. SUSPENDED and REVOKED restore buying, which design §6.3 states outright —
 * losing certification is not a punishment that also stops you shopping.
 */
export const canActAsBuyer = (merchantCapabilityStatus: CapabilityStatus | string | null): boolean =>
  merchantCapabilityStatus !== 'ACTIVE';
