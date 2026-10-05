// Cannibalized from kumtru/backend-apis/src/modules/identity/infrastructure/crypto.ts (T-001),
// adapted twice: the pepper is an argument rather than a module-level `config.identity.hmacPepper`
// read — so identity, logistics and the rest share this one helper with their own key instead of
// each keeping a copy — and the domain is length-prefixed rather than joined with a space.
//
// Two distinct jobs, deliberately not one primitive:
//
//  - `hmac` — deterministic, keyed, one-way. For anything we must LOOK UP but must never read back:
//    OTP codes, Park handover PINs, invitation destinations, claimed identifiers in a recovery
//    request. Keyed rather than a bare SHA-256 because the input space is tiny — a 4-digit PIN is
//    10^4, and a plain hash of that is a rainbow table someone builds in a second.
//
//  - `sha256` — unkeyed, for refresh tokens. Correct there precisely because a refresh token is
//    already 256 bits of uniform randomness, so there is nothing to brute-force and no pepper to
//    rotate. A key would make verification depend on a secret that, if lost, logs out every user for
//    no security gain.
//
// Reversible material (TOTP seeds, OAuth tokens, a PIN we must show its rightful party) goes through
// crypto/encryption.ts instead.
import crypto from 'node:crypto';

const toBuffer = (value: string | Buffer): Buffer =>
  Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');

export const sha256 = (value: string | Buffer): Buffer =>
  crypto.createHash('sha256').update(toBuffer(value)).digest();

/**
 * Domain-separated HMAC-SHA256.
 *
 * The `domain` is not decoration. Without it the HMAC of `"482913"` is the same value whether it was
 * an OTP or a handover PIN, so a leaked row from one table confirms a guess against the other. Every
 * call site names its domain.
 *
 * The domain's byte length is written in front of it, rather than the old `${domain} ${value}` join,
 * because that join is not injective: domain `otp a` with value `b` and domain `otp` with value
 * `a b` produce the same digest, which is exactly the cross-table confirmation the domain prevents.
 */
export function hmac(key: string | Buffer, domain: string, value: string | Buffer): Buffer {
  const keyBytes = toBuffer(key);
  if (keyBytes.length === 0) throw new Error('hmac requires a non-empty key');

  const domainBytes = Buffer.from(domain, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(domainBytes.length);

  return crypto
    .createHmac('sha256', keyBytes)
    .update(Buffer.concat([length, domainBytes, toBuffer(value)]))
    .digest();
}

/**
 * HMAC under a scheme we do not get to choose.
 *
 * `hmac` above length-prefixes a domain because the values it protects are low-entropy and shared
 * across tables. A provider webhook signature is neither: the signed value is the whole request body,
 * and the algorithm, the framing and the encoding are the provider's published contract. Adding our
 * domain prefix here would simply produce a digest that never matches the one the provider sent, so
 * this helper deliberately hashes the value and nothing else. It is not for anything we store.
 */
export function providerHmac(
  algorithm: 'sha256' | 'sha512',
  key: string | Buffer,
  value: string | Buffer,
): Buffer {
  const keyBytes = toBuffer(key);
  if (keyBytes.length === 0) throw new Error('providerHmac requires a non-empty key');

  return crypto.createHmac(algorithm, keyBytes).update(toBuffer(value)).digest();
}

/**
 * Constant-time buffer comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself be an oracle, so unequal lengths
 * are reported as a mismatch after a same-cost comparison of fixed-size digests.
 */
export function timingSafeEqualBuffers(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    // Burn a comparable amount of work so the early exit is not measurable.
    crypto.timingSafeEqual(sha256(a), sha256(b));
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

export interface HmacHasher {
  hmac(domain: string, value: string | Buffer): Buffer;
  /** Constant-time check of `value` against a stored digest. */
  matches(domain: string, value: string | Buffer, expected: Buffer): boolean;
}

/** Binds a module's pepper once, so call sites never handle key material. */
export function createHmacHasher(key: string | Buffer): HmacHasher {
  const keyBytes = toBuffer(key);
  if (keyBytes.length === 0) throw new Error('createHmacHasher requires a non-empty key');

  return {
    hmac: (domain, value) => hmac(keyBytes, domain, value),
    matches: (domain, value, expected) => timingSafeEqualBuffers(hmac(keyBytes, domain, value), expected),
  };
}
