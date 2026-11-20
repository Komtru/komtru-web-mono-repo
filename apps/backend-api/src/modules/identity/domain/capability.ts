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
 * Always true. Owner ruling 2026-11-20: there are no buyer accounts and seller accounts, only
 * accounts, and a certified merchant buys like anyone else. Merchant status now only lifts the
 * selling limit (`trades/domain/sellLimit.ts`). This replaces design §6.3's "sell-only while
 * ACTIVE" rule.
 *
 * The status parameter and the gate plumbing that calls this (`MERCHANT_CANNOT_BUY`, the buyer
 * paths) are kept so a future per-account buy block has one place to live; today nothing trips it.
 * An account that may not trade at all is still refused, by the account-status check in
 * `capability.service.ts`.
 */
export const canActAsBuyer = (_merchantCapabilityStatus: CapabilityStatus | null): boolean => true;
