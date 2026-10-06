// Design §6.3 (owner ruling, 2026-10-05). Every account can buy or sell and the initiator picks the
// side per trade; a certified merchant is sell-only while the capability is ACTIVE. M7 §5's "seller
// holds an ACTIVE SELLER capability" gate is gone (conflict C19) — the money-safety gates stay.
//
// `canActAsBuyer` is one rule, checked server-side everywhere someone would become a buyer. Design
// §6.3 calls it an identity function, and since T-035 identity exports one — so this module
// DELEGATES to it rather than keeping a second copy, which is what this file's original note asked
// for. What stays here is what trades does with the answer: the paths, the errors, and the funding
// gates, none of which identity has any business knowing about.
import { canActAsBuyer as identityCanActAsBuyer } from '../../identity/index.js';
import { buyerNotVerifiedError, merchantCannotBuyError, sellerNotVerifiedError } from './errors.js';

/** Every place a user would take the buyer side. Each is checked, and each names itself when it fails. */
export const BUYER_PATHS = [
  'CREATE_TRADE_AS_BUYER',
  'NAMED_AS_BUYER',
  'ACCEPT_AS_BUYER',
  'CLAIM_BUYER_INVITATION',
  'CART_CHECKOUT',
  'BUY_FROM_LISTING',
] as const;
export type BuyerPath = (typeof BUYER_PATHS)[number];

export type TradeInitiatorRole = 'BUYER' | 'SELLER';

/**
 * M1 §5.1's levels, in order. Ranked here rather than in shared-types because nothing outside the
 * backend compares levels yet, and a frontend that could would be deciding a gate the server owns.
 */
const VERIFICATION_LEVELS = [
  'UNVERIFIED',
  'CONTACT_VERIFIED',
  'IDENTITY_VERIFIED',
  'BUSINESS_VERIFIED',
  'ENHANCED',
] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

export type CapabilityStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';

/** What every gate needs about a person, read once per request (infrastructure/principals.ts). */
export interface TradePrincipal {
  userId: string;
  /** NULL when the account never applied for merchant certification. */
  merchantCapabilityStatus: CapabilityStatus | null;
  verificationLevel: VerificationLevel;
}

const atLeast = (level: VerificationLevel, required: VerificationLevel): boolean =>
  VERIFICATION_LEVELS.indexOf(level) >= VERIFICATION_LEVELS.indexOf(required);

/** False only while the account holds an ACTIVE MERCHANT capability; losing it restores buying. */
export const canActAsBuyer = (principal: TradePrincipal): boolean =>
  identityCanActAsBuyer(principal.merchantCapabilityStatus);

export function assertCanActAsBuyer(principal: TradePrincipal, path: BuyerPath): void {
  if (!canActAsBuyer(principal)) throw merchantCannotBuyError(path);
}

/** `POST /trades` takes the side; a certified merchant may only be SELLER, and asking for BUYER fails. */
export function initiatorRoleFor(
  principal: TradePrincipal,
  requested: TradeInitiatorRole,
): TradeInitiatorRole {
  if (requested === 'BUYER') assertCanActAsBuyer(principal, 'CREATE_TRADE_AS_BUYER');
  return requested;
}

/**
 * The two gates money depends on (design §6.3): the buyer is contact-verified (M1 level 1) to fund,
 * and the seller is identity-verified (M6 level 2) before a trade can be funded, so a payout only
 * ever goes to someone we have identified. Q12 asks whether to relax the second for casual sellers.
 *
 * Deliberately no check on the buyer's merchant capability: a trade already in flight when
 * certification is approved finishes normally on both sides.
 */
export function assertFundingEligibility(buyer: TradePrincipal, seller: TradePrincipal): void {
  if (!atLeast(buyer.verificationLevel, 'CONTACT_VERIFIED')) throw buyerNotVerifiedError();
  if (!atLeast(seller.verificationLevel, 'IDENTITY_VERIFIED')) throw sellerNotVerifiedError();
}
