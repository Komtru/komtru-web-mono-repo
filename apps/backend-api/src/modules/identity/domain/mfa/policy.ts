// When a second factor is demanded, and the numbers that bound the ceremony.
//
// This file is deliberately pure and deliberately small, because it is the ONE place that answers
// "does this sign-in need a second factor". A login that worked the answer out inline would be a
// login where the answer can drift; a function with no database in it can be tested against D2 C4
// and §S13 directly, which is what `policy.test.ts` does.
import type { SessionScope } from '@komtru/shared-types';

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
