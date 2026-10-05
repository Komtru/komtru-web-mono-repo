// Cannibalized from kumtru/backend-apis/src/modules/identity/infrastructure/crypto.ts (T-001),
// adapted: both arguments are range-checked, because the old defaults were the only values anyone
// passed and the failures outside them are quiet ones.
import crypto from 'node:crypto';

/** Below this the token is guessable by someone with a list of them; §D5 asks for 256 bits. */
const MIN_TOKEN_BYTES = 16;

/**
 * `crypto.randomInt` rejects a range above 2^48, and 10^15 is over it, so 14 digits is the largest
 * code this can draw. Caught here rather than in Node, where the message names neither the argument
 * nor the limit.
 */
const MAX_CODE_DIGITS = 14;

/** Cryptographically random opaque token, URL-safe. 32 bytes = 256 bits, per §D5. */
export function randomToken(bytes = 32): string {
  if (bytes < MIN_TOKEN_BYTES) throw new Error(`randomToken needs at least ${MIN_TOKEN_BYTES} bytes`);
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * A uniformly distributed numeric code: 6 digits for an OTP (§S6), 4 for a Park handover PIN.
 *
 * `randomInt` rather than `randomBytes % 10 ** digits`: the modulo is biased, because 2^k is not a
 * multiple of a power of ten, and a biased code is a smaller search space than it looks. The result
 * is zero-padded, so `000042` is a legitimate 6-digit code and the low end is not thrown away.
 */
export function randomNumericCode(digits = 6): string {
  if (!Number.isInteger(digits) || digits < 1 || digits > MAX_CODE_DIGITS) {
    throw new Error(`randomNumericCode needs a digit count between 1 and ${MAX_CODE_DIGITS}`);
  }

  return crypto
    .randomInt(0, 10 ** digits)
    .toString()
    .padStart(digits, '0');
}
