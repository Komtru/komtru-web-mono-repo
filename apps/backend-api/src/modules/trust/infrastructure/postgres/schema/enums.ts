// M6 §6.1's enumerations, declared inline rather than built from @komtru/shared-types for the same
// reason the files module gives: nothing in this ticket puts a verification type on the wire as a
// shared contract, and the one value below that the spec does not have is this build's.
import { trust } from './columns.js';

/**
 * All eight, including the five T-051 and T-052 will use: `liveness_checks.matched_against` and
 * `kyc_provider_calls.call_type` are typed by this enum, and a later ticket adding a member to a
 * Postgres enum is a migration those tickets should not have to spend.
 */
export const VERIFICATION_TYPES = [
  'NIN',
  'BVN',
  'LIVENESS',
  'CAC',
  'BANK_ACCOUNT_NAME_MATCH',
  'ADDRESS',
  'DOCUMENT',
  'SOCIAL_PROOF',
] as const;

export const VERIFICATION_REQUEST_STATUSES = [
  'SUBMITTED', // accepted from the user, not yet sent to a provider
  'PROVIDER_PENDING', // sent, awaiting the provider's answer
  'PROVIDER_PASSED',
  'PROVIDER_FAILED',
  'MANUAL_REVIEW', // ambiguous, or a duplicate identifier — a human decides (§7)
  'APPROVED', // terminal: counts toward a level
  'REJECTED', // terminal: does not
  'EXPIRED', // never completed, swept
] as const;

/**
 * The six vendors M6 §8 shortlists, plus `MANUAL` for an analyst's own attestation — and `FAKE`.
 *
 * `FAKE` is this build's addition, and it is deliberate rather than convenient. The owner's decision
 * Q7 is that no KYC provider account exists yet, so every level this module grants today is granted
 * on the word of a deterministic stub. Recording that in the same column that would otherwise say
 * `DOJAH` means the question "which identity levels were never attested by anyone" is one query,
 * answerable the day real credentials arrive. A fake that signs its work as a real vendor is a fake
 * that hides itself.
 */
export const KYC_PROVIDERS = [
  'SMILE_IDENTITY',
  'YOUVERIFY',
  'PREMBLY',
  'DOJAH',
  'VERIFYME',
  'MANUAL',
  'FAKE',
] as const;

/** §6.11's `direction`, an enum here rather than the spec's free text: there are exactly two. */
export const LEVEL_CHANGE_DIRECTIONS = ['GRANT', 'REVOKE'] as const;

/** §6.11's `actor_type`. `SYSTEM` covers the expiry sweep and any future automated revocation. */
export const LEVEL_CHANGE_ACTOR_TYPES = ['PROVIDER_AUTO', 'KYC_ANALYST', 'SYSTEM'] as const;

export const verificationType = trust.enum('verification_type', VERIFICATION_TYPES);
export const verificationRequestStatus = trust.enum(
  'verification_request_status',
  VERIFICATION_REQUEST_STATUSES,
);
export const kycProvider = trust.enum('kyc_provider', KYC_PROVIDERS);
export const levelChangeDirection = trust.enum('level_change_direction', LEVEL_CHANGE_DIRECTIONS);
export const levelChangeActorType = trust.enum('level_change_actor_type', LEVEL_CHANGE_ACTOR_TYPES);

export type VerificationType = (typeof VERIFICATION_TYPES)[number];
export type VerificationRequestStatus = (typeof VERIFICATION_REQUEST_STATUSES)[number];
export type KycProvider = (typeof KYC_PROVIDERS)[number];
export type LevelChangeDirection = (typeof LEVEL_CHANGE_DIRECTIONS)[number];
export type LevelChangeActorType = (typeof LEVEL_CHANGE_ACTOR_TYPES)[number];

/** The two identifiers this module hashes. Narrower than `VerificationType` on purpose. */
export type IdentifierType = Extract<VerificationType, 'NIN' | 'BVN'>;
