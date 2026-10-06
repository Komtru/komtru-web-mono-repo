// The PartyCard (M1 §8.2): the ONLY shape party lookup ever returns.
//
// §8.2 lists what must never leave through it — email, phone, legal name, address, date of birth,
// bank details, status detail, any KYC field. The way to keep that true over years of edits is for
// one pure function to build the whole object from a named input type, so adding a field is a
// deliberate act in this file rather than a column that rides along on a `SELECT *`. The card test
// asserts the exact key set for the same reason.
import { canActAsBuyer, type CapabilityStatus } from '../capability.js';

/**
 * The display vocabulary, which is NOT `verification_level` (§8.2 is explicit that they are two
 * different things). Order is the order they are rendered in.
 */
export const PARTY_BADGES = [
  'EMAIL_VERIFIED',
  'PHONE_VERIFIED',
  'IDENTITY_VERIFIED',
  'BUSINESS_VERIFIED',
  'ENHANCED_DUE_DILIGENCE',
] as const;
export type PartyBadge = (typeof PARTY_BADGES)[number];

/** M1 §5.1's levels, in order. The index is the rank a badge is gated on. */
const VERIFICATION_LEVELS = [
  'UNVERIFIED',
  'CONTACT_VERIFIED',
  'IDENTITY_VERIFIED',
  'BUSINESS_VERIFIED',
  'ENHANCED',
] as const;

/**
 * An unknown level ranks as the FLOOR, not the ceiling.
 *
 * `indexOf` returns -1 for a level M6 adds later, and comparing `-1 >= 2` is false — which is the
 * safe direction. Spelling it out so nobody "fixes" it into a lookup that defaults high: on a trust
 * platform a badge implying a level the user has not attained is worse than no badge at all (§8.2).
 */
const rank = (level: string): number =>
  VERIFICATION_LEVELS.indexOf(level as (typeof VERIFICATION_LEVELS)[number]);

export interface PartyFacts {
  publicId: string;
  username: string | null;
  displayName: string | null;
  /** M20's PROFILE_PHOTO file id (M1 D7). Never a provider URL. */
  avatarFileId: string | null;
  verificationLevel: string;
  createdAt: Date;
  emailVerified: boolean;
  phoneVerified: boolean;
  merchantCapabilityStatus: CapabilityStatus | null;
}

/** What identity cannot answer on its own: M7's trade count, M5's merchant name, M20's signed URL. */
export interface PartyEnrichment {
  completedTrades: number;
  merchantName: string | null;
  avatarUrl: string | null;
}

export interface PartyCard {
  publicId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  verificationLevel: string;
  badges: PartyBadge[];
  /** `YYYY-MM-DD`: the month someone joined is a trust signal, the minute is not. */
  memberSince: string;
  completedTrades: number;
  isMerchant: boolean;
  merchantName: string | null;
  /** Design §6.3: false for a certified merchant, so the proposer sees it before sending. */
  canBuy: boolean;
}

/**
 * The badge set for a level and the two contact facts.
 *
 * EMAIL_VERIFIED and PHONE_VERIFIED come from the contact rows rather than from the level, because
 * they are observations and not grades: a phone-first account has a verified phone and no verified
 * email, and `verification_level` (which needs BOTH to reach CONTACT_VERIFIED) cannot express that.
 * The three levelled badges are gated on the level, and only ever downwards.
 */
export const badgesFor = (
  verificationLevel: string,
  contacts: { emailVerified: boolean; phoneVerified: boolean },
): PartyBadge[] => {
  const level = rank(verificationLevel);
  const badges: PartyBadge[] = [];

  if (contacts.emailVerified) badges.push('EMAIL_VERIFIED');
  if (contacts.phoneVerified) badges.push('PHONE_VERIFIED');
  if (level >= rank('IDENTITY_VERIFIED')) badges.push('IDENTITY_VERIFIED');
  if (level >= rank('BUSINESS_VERIFIED')) badges.push('BUSINESS_VERIFIED');
  if (level >= rank('ENHANCED')) badges.push('ENHANCED_DUE_DILIGENCE');

  return badges;
};

export const partyCard = (facts: PartyFacts, enrichment: PartyEnrichment): PartyCard => ({
  publicId: facts.publicId,
  username: facts.username,
  displayName: facts.displayName,
  avatarUrl: enrichment.avatarUrl,
  verificationLevel: facts.verificationLevel,
  badges: badgesFor(facts.verificationLevel, facts),
  memberSince: facts.createdAt.toISOString().slice(0, 10),
  completedTrades: enrichment.completedTrades,
  isMerchant: facts.merchantCapabilityStatus === 'ACTIVE',
  merchantName: enrichment.merchantName,
  canBuy: canActAsBuyer(facts.merchantCapabilityStatus),
});
