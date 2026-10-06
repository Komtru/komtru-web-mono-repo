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
