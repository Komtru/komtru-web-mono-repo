// The arithmetic and the hashing behind `identity.otp_challenges`, with no database in sight.
//
// §S6 in one paragraph: six cryptographically random digits, five minutes, single use, invalidated
// when a new code is issued for the same purpose and destination, and stored as an HMAC. The HMAC
// and not a bare SHA-256 because the input space is 10^6 — a plain hash of a six-digit code is a
// table anyone builds in a second, and the pepper is what makes a leaked row useless on its own.
import { z } from 'zod';
import type { HmacHasher } from '../../../../platform/crypto/hmac.js';

export const OTP_CODE_DIGITS = 6;
export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 5;

/**
 * How long after it was created a challenge can still be RESENT from — as opposed to verified
 * against, which is `OTP_TTL_SECONDS` and not a second more.
 *
 * The two are different questions. Verifying asks "is this code still good?"; resending asks "is
 * this the sign-up the person is still looking at?", and the answer to that outlives the code by a
 * long way. Tying them together is what made an expired sign-up unrecoverable: the only control on
 * screen is "Send a new code", and the endpoint behind it refused the moment the code it was
 * replacing went stale.
 *
 * A day rather than forever, because the id is the whole of what a resend needs. It is unguessable
 * and it only ever sends to the account's own primary contact, so a leaked one buys an attacker
 * nothing but noise on somebody else's phone — and §S4's 3-per-10-minutes still caps that. The
 * bound is here so an id scraped out of a log months later is not still live.
 */
export const OTP_RESEND_WINDOW_SECONDS = 86_400;

/** §S4: OTP send 3/10min/destination, 10/day. Counted against the challenge rows themselves. */
export const OTP_SEND_BURST = { max: 3, windowSeconds: 600 } as const;
export const OTP_SEND_DAILY = { max: 10, windowSeconds: 86_400 } as const;

/** §D5's 256 bits, for the password-reset token the OTP is exchanged for. */
export const PROOF_TOKEN_BYTES = 32;

/**
 * Fifteen minutes, not five: the OTP proves the channel, and the user then has to think of a
 * password, type it twice and get past the policy. Five minutes of that is a user locked out of
 * their own recovery, and the token is 256 bits — the short life is about limiting the window a
 * captured token is useful in, not about brute force, which is not on the table.
 */
export const PROOF_TOKEN_TTL_SECONDS = 900;

/**
 * Two domains, never one. Both columns hold an HMAC of a short string; without the split, the digest
 * of `482913` is the same value whether it was somebody's code or somebody's destination, and a
 * leaked row from one column confirms a guess against the other.
 */
export const OTP_DESTINATION_DOMAIN = 'identity.otp.destination';
export const OTP_CODE_DOMAIN = 'identity.otp.code';

export const OTP_PURPOSES = [
  'REGISTRATION',
  'LOGIN',
  'PHONE_VERIFICATION',
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
  'MFA_CHALLENGE',
  'SENSITIVE_ACTION',
  'ACCOUNT_RECOVERY',
] as const;

export type OtpPurpose = (typeof OTP_PURPOSES)[number];

/** The copy that fills `{{purpose}}` in the seeded template. Lower case: it sits mid-sentence. */
const PURPOSE_LABEL: Record<OtpPurpose, string> = {
  REGISTRATION: 'verification',
  LOGIN: 'sign-in',
  PHONE_VERIFICATION: 'phone verification',
  EMAIL_VERIFICATION: 'email verification',
  PASSWORD_RESET: 'password reset',
  MFA_CHALLENGE: 'two-factor',
  SENSITIVE_ACTION: 'confirmation',
  ACCOUNT_RECOVERY: 'account recovery',
};

export const otpPurposeLabel = (purpose: OtpPurpose): string => PURPOSE_LABEL[purpose];

export const otpExpiry = (from: Date): Date => new Date(from.getTime() + OTP_TTL_SECONDS * 1000);

export const proofTokenExpiry = (from: Date): Date =>
  new Date(from.getTime() + PROOF_TOKEN_TTL_SECONDS * 1000);

/**
 * The destination exactly as it will be stored elsewhere — `normaliseEmail().emailNormal` or
 * `normalisePhone().phoneE164`. This function deliberately does NOT normalise: canonicalisation is
 * the service boundary's job (T-030's standing rule), and doing it in two places is how two places
 * come to disagree.
 */
export const hashDestination = (hasher: HmacHasher, destination: string): Buffer =>
  hasher.hmac(OTP_DESTINATION_DOMAIN, destination);

export interface CodeInput {
  purpose: OtpPurpose;
  destinationHash: Buffer;
  code: string;
}

/**
 * The stored `code_hash`, bound to the purpose and the destination as well as the pepper.
 *
 * Binding matters because the same six digits are drawn for thousands of live challenges: without
 * it, one leaked row tells an attacker the hash of `482913` under our pepper, and every other
 * challenge currently holding that code is then readable from the same table.
 *
 * The three parts are joined by the hasher's own length-prefixed domain plus a separator that cannot
 * appear in a hex digest or a numeric code, so the concatenation is injective.
 */
export const hashCode = (hasher: HmacHasher, input: CodeInput): Buffer =>
  hasher.hmac(OTP_CODE_DOMAIN, `${input.purpose}:${input.destinationHash.toString('hex')}:${input.code}`);

/** Constant-time. `HmacHasher.matches` handles the length mismatch that would itself be an oracle. */
export const matchesCode = (hasher: HmacHasher, input: CodeInput, stored: Buffer): boolean =>
  hasher.matches(
    OTP_CODE_DOMAIN,
    `${input.purpose}:${input.destinationHash.toString('hex')}:${input.code}`,
    stored,
  );

const uuid = z.uuid();

/**
 * A reset token is `<challengeId>.<secret>`.
 *
 * The id is validated here rather than at the database: a token is a public input, and handing
 * `'; DROP'` to a `::uuid` cast is a 22P02 and a 500 instead of the uniform rejection the caller
 * should get. The secret keeps any dots it contains — `base64url` has none, but a split that
 * silently truncated one would fail to verify a perfectly good token.
 */
export const splitProofToken = (token: string): { challengeId: string; secret: string } | null => {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;

  const challengeId = token.slice(0, dot);
  if (!uuid.safeParse(challengeId).success) return null;

  return { challengeId, secret: token.slice(dot + 1) };
};
