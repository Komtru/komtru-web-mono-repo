// Everything this module keeps about a NIN or a BVN, as pure functions (D1).
//
// Three outputs and no fourth: a masked display value, a keyed HMAC for the duplicate check, and —
// from the caller — the provider's own reference. The number itself exists between the request body
// and the provider call and nowhere else. There is deliberately no `unmask`, no `encryptIdentifier`
// and no reverse of any kind: a column we cannot read back is a column a breach cannot read back.
import type { HmacHasher } from '../../../platform/crypto/hmac.js';
import type { IdentifierType } from '../infrastructure/postgres/schema/enums.js';

/** Both are eleven digits in Nigeria. */
const DIGITS = 11;
const ONLY_DIGITS = /^\d+$/;
const VISIBLE_SUFFIX = 4;

/**
 * Domain separation for the HMAC (platform/crypto/hmac.ts).
 *
 * Without it the digest of `'12345678901'` is one value whether it was a NIN or a BVN, so a leaked
 * `nin_verifications` row confirms a guess against `bvn_verifications` for free — and a Nigerian
 * user's NIN and BVN are frequently the same person's two numbers, which makes that correlation
 * worth something to an attacker.
 */
export const HASH_DOMAIN: Record<IdentifierType, string> = {
  NIN: 'trust:nin',
  BVN: 'trust:bvn',
};

/** Everything that is not a digit goes: users type spaces and hyphens, and both mean nothing. */
export const normaliseIdentifier = (raw: string): string => raw.replace(/\D/g, '');

/**
 * Shape only.
 *
 * Deliberately not a checksum or an allocation-range check: NIMC does not publish one, the provider
 * is the authority on whether a number exists, and a client-side rule that guesses refuses real
 * numbers belonging to real people — which is a verification failure the user cannot act on.
 */
export const isValidIdentifier = (_type: IdentifierType, normalised: string): boolean =>
  normalised.length === DIGITS && ONLY_DIGITS.test(normalised);

/**
 * §6.3's display form. The last four digits are what a support agent reads back to a caller.
 *
 * A value no longer than the suffix is masked entirely rather than shown. Callers only reach this
 * after `isValidIdentifier`, so in practice the input is always eleven digits — but a mask whose
 * degenerate case is "print the whole thing" is one validation change away from being the leak, and
 * this function is the single place D1's display promise is kept.
 */
export const maskIdentifier = (normalised: string): string => {
  if (normalised.length <= VISIBLE_SUFFIX) return '*'.repeat(normalised.length);
  return '*'.repeat(normalised.length - VISIBLE_SUFFIX) + normalised.slice(-VISIBLE_SUFFIX);
};

/**
 * The duplicate-detection key.
 *
 * Throws on an un-normalised input rather than hashing it: `'123-456-789-01'` and `'12345678901'`
 * would produce different digests for the same person, and the §7 duplicate check would silently
 * stop finding anything — a failure with no symptom until a suspended seller is back trading.
 */
export function identifierHash(hasher: HmacHasher, type: IdentifierType, normalised: string): Buffer {
  if (normaliseIdentifier(normalised) !== normalised) {
    throw new TypeError('identifierHash(): the identifier must be normalised before it is hashed');
  }
  return hasher.hmac(HASH_DOMAIN[type], normalised);
}

/** The CAC's own prefixes, which users type inconsistently and which carry no information. */
const RC_PREFIX = /^(RC|BN|IT|LP|LLP)/;
const RC_MIN = 4;
const RC_MAX = 20;

/**
 * A CAC registration number, normalised.
 *
 * Unlike a NIN this is public record and is stored in the clear (§6.5), so this function exists for
 * one reason only: `RC 1487322`, `rc-1487322` and `1487322` are one registration, and §7's "is this
 * RC already the primary verified business of another merchant" check compares strings. Without a
 * single normal form that check silently stops finding anything, which is a failure with no symptom
 * until a suspended merchant is trading again under a second account.
 *
 * The prefix is dropped rather than kept: CAC's own search accepts the number with or without it,
 * and keeping it would make `BN1487322` and `1487322` two different businesses to us.
 */
export const normaliseRcNumber = (raw: string): string =>
  raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(RC_PREFIX, '');

/**
 * Shape only, and loose on purpose — the same posture `isValidIdentifier` takes.
 *
 * CAC numbers have changed format more than once (plain RC numbers, BN numbers, the post-2021
 * unified registration numbers), the provider is the authority on whether one exists, and a strict
 * client-side rule here refuses real businesses whose number predates whatever pattern we guessed.
 */
export const isValidRcNumber = (normalised: string): boolean =>
  normalised.length >= RC_MIN && normalised.length <= RC_MAX && /^[A-Z0-9]+$/.test(normalised);

/**
 * The §7 duplicate key for a business.
 *
 * Hashed even though the RC number is public, because it travels on
 * `trust.verification.duplicate_identity_detected`, whose `identifierHashHex` field every consumer
 * already reads as an opaque correlation key. Putting a plain RC number in that field for CAC and a
 * hash for NIN would mean two shapes behind one name — and a consumer comparing the two across
 * types would quietly never match.
 */
export function rcNumberHash(hasher: HmacHasher, normalised: string): Buffer {
  if (normaliseRcNumber(normalised) !== normalised) {
    throw new TypeError('rcNumberHash(): the RC number must be normalised before it is hashed');
  }
  return hasher.hmac('trust:cac', normalised);
}

/**
 * A keyed HMAC of a full, normalised NUBAN, domain-separated like the identifier hashes.
 *
 * It exists so a bank name-match is read back for EXACTLY the account that was checked: the last four
 * digits are not an identity, and two accounts at one bank can share them.
 */
export function bankAccountHash(hasher: HmacHasher, normalisedAccountNumber: string): Buffer {
  if (!/^\d+$/.test(normalisedAccountNumber)) {
    throw new TypeError('bankAccountHash(): the account number must be digits only');
  }
  return hasher.hmac('trust:bank-account', normalisedAccountNumber);
}
