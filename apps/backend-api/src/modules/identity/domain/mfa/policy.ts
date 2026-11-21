// When a second factor is demanded, and the numbers that bound the ceremony.
//
// This file is deliberately pure and deliberately small, because it is the ONE place that answers
// "does this sign-in need a second factor". A login that worked the answer out inline would be a
// login where the answer can drift; a function with no database in it can be tested against D2 C4
// and §S13 directly, which is what `policy.test.ts` does.
import type { SessionScope } from '@komtru/shared-types';
import type { HmacHasher } from '../../../../platform/crypto/hmac.js';

/**
 * Five minutes for the `mfaToken`, the same as an OTP (§S6).
 *
 * Long enough to open an authenticator app or fetch an SMS, short enough that a token captured off
 * a screen is worthless by the time anyone uses it. It is NOT a session: it proves one password
 * check, once.
 */
export const MFA_TOKEN_TTL_SECONDS = 300;

/** §S4's "OTP verify 5 attempts per challenge", applied to the factor behind an `mfaToken`. */
export const MFA_MAX_ATTEMPTS = 5;

/** §D5's 256 bits. The `mfaToken` and the `stepUpToken` are both bearer secrets, never guessed. */
export const MFA_TOKEN_BYTES = 32;

/** The same five minutes for a step-up proof: it is spent on the very next request or not at all. */
export const STEP_UP_TTL_SECONDS = 300;

/**
 * The `destination_hash` domain for a challenge that has no destination.
 *
 * `otp_challenges.destination_hash` is NOT NULL and every other row holds an HMAC of an email or a
 * phone. An MFA token and a step-up token are bound to an ACCOUNT, not to an address, so they hash
 * the user id under a domain of their own — which also keeps them out of §S4's per-destination send
 * budget and out of `issueOtp`'s supersede, both of which key on that column.
 */
export const MFA_SUBJECT_DOMAIN = 'identity.mfa.subject';

/**
 * The same challenge under a domain of its own for a STAFF sign-in (T-037).
 *
 * The scope a session opens with is decided where the `mfaToken` is spent, so the token has to be
 * bound to the scope it was issued for. Binding it through the hash domain costs no column and no
 * migration, and it means a consumer `mfaToken` presented to `/auth/staff/mfa/verify` finds no
 * challenge with a matching `destination_hash` (and the other way round): a CONSUMER password check
 * can never be traded for a STAFF session, and a staff check does not open a consumer one either.
 */
export const MFA_STAFF_SUBJECT_DOMAIN = 'identity.mfa.subject.staff';

/**
 * T-086: the same separation for `/auth/logistics/mfa/verify`. A consumer or staff `mfaToken` cannot
 * open a LOGISTICS session, and a logistics one cannot open either of theirs.
 */
export const MFA_LOGISTICS_SUBJECT_DOMAIN = 'identity.mfa.subject.logistics';

/** The scopes a sign-in challenge is issued under: every session scope. */
export type MfaScope = 'CONSUMER' | 'STAFF' | 'LOGISTICS';

const MFA_SUBJECT_DOMAINS: Record<MfaScope, string> = {
  CONSUMER: MFA_SUBJECT_DOMAIN,
  STAFF: MFA_STAFF_SUBJECT_DOMAIN,
  LOGISTICS: MFA_LOGISTICS_SUBJECT_DOMAIN,
};

/**
 * The same shape for an ENROLMENT ceremony, under a domain of its own.
 *
 * From review, and it is not decoration. Both families are `otp_challenges` rows of purpose
 * MFA_CHALLENGE scoped to a user, and `issueOtp`-style supersedes and `findLiveChallengeFor` key on
 * `(destination_hash, purpose, user_id)`. Under one hash they were one family, so signing in on a
 * second device superseded a half-finished enrolment — killing the QR code the user had just
 * scanned, with a 422 telling them to start again — and finishing any enrolment consumed a live
 * sign-in challenge. Two domains make the two families unable to see each other.
 */
export const MFA_ENROLMENT_DOMAIN = 'identity.mfa.enrolment';

/** `otp_challenges.destination_hash` for a challenge bound to an account rather than an address. */
export const mfaSubjectHash = (hasher: HmacHasher, userId: string, scope: MfaScope = 'CONSUMER'): Buffer =>
  hasher.hmac(MFA_SUBJECT_DOMAINS[scope], userId);

export const mfaEnrolmentHash = (hasher: HmacHasher, userId: string): Buffer =>
  hasher.hmac(MFA_ENROLMENT_DOMAIN, userId);

export type MfaFactorType = 'TOTP' | 'SMS_OTP' | 'EMAIL_OTP' | 'PASSKEY' | 'RECOVERY_CODE';

/**
 * Recovery codes are not a factor.
 *
 * They are the way back in when the phone is gone, and an account holding only these has nothing to
 * present at a login that it was not already handed on a screen. Counting them would also mean a
 * user who enrols TOTP and then removes it stays "two-factor" forever.
 */
const SECOND_FACTORS: readonly MfaFactorType[] = ['TOTP', 'SMS_OTP', 'EMAIL_OTP', 'PASSKEY'];

export const isSecondFactor = (type: MfaFactorType): boolean => SECOND_FACTORS.includes(type);

/** RFC 8176 authentication method references, as `sessions.amr` records them. */
const AMR: Record<MfaFactorType, string> = {
  TOTP: 'otp',
  SMS_OTP: 'sms',
  EMAIL_OTP: 'otp',
  PASSKEY: 'passkey',
  RECOVERY_CODE: 'recovery',
};

export const factorAmr = (type: MfaFactorType): string => AMR[type];

export interface MfaRequirementInput {
  scope: SessionScope;
  activeFactorTypes: readonly MfaFactorType[];
  /** A live, approved, unexpired admin role grant (D2 C4). */
  holdsAdminRole: boolean;
  /** `IDENTITY_STAFF_REQUIRE_MFA`. */
  staffRequireMfa: boolean;
}

export interface MfaRequirement {
  required: boolean;
  /** True only on the STAFF path: C4's forced-setup state, where the rule applies and no factor exists. */
  enrolmentRequired: boolean;
}

/**
 * D2 C4 and §S13 in one expression.
 *
 * STAFF is the only scope where MFA is demanded of an account that does not have it: §S13 makes a
 * staff session's second factor mandatory, and C4 says granting an admin role to a user without one
 * puts them in forced setup. Consumer and logistics sessions ask for a factor when the account has
 * one, and otherwise let the holder in — forcing an admin's CONSUMER session through setup would
 * lock them out of the very `/me` routes enrolment lives on, and a consumer session with no factor
 * is already bounded by the §S7 step-up gate on everything that matters.
 */
export function mfaRequirement(input: MfaRequirementInput): MfaRequirement {
  const hasFactor = input.activeFactorTypes.some(isSecondFactor);

  if (input.scope === 'STAFF' && input.staffRequireMfa) {
    return { required: true, enrolmentRequired: !hasFactor };
  }

  return { required: hasFactor, enrolmentRequired: false };
}
