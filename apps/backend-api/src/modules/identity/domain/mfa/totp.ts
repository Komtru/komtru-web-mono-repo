// RFC 6238 (TOTP) over RFC 4226 (HOTP), with RFC 4648 base32 for the secret.
//
// Written rather than installed, for one reason: the specification publishes test vectors, so this
// file can be PROVED against the standard instead of trusted to a package. It is forty lines of
// arithmetic over `node:crypto`, and the alternative is a dependency and its transitive tree on the
// authentication path.
//
// SHA-1 is not a lapse. Every authenticator app in circulation — Google Authenticator, Authy, 1Password,
// iOS Passwords — implements HMAC-SHA1 with 6 digits and a 30-second step, and several ignore the
// `algorithm` parameter of the otpauth URI outright. A SHA-256 seed would be silently truncated or
// silently mis-verified on a user's phone, and HMAC-SHA1 is not weakened by SHA-1's collision
// results: HOTP depends on HMAC's pseudorandomness, not on collision resistance.
import crypto from 'node:crypto';
import { timingSafeEqualBuffers } from '../../../../platform/crypto/hmac.js';

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** ±1 step. One step each way absorbs a slow user and a phone clock a few seconds out. */
export const TOTP_WINDOW_STEPS = 1;
/** RFC 4226 R6 asks for at least 128 bits and recommends 160. */
export const TOTP_SECRET_BYTES = 20;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  // The leftover bits are left-aligned into one final character, and padding is omitted: an
  // otpauth URI carries the secret unpadded and every authenticator accepts it that way.
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * `null` for anything that is not base32, rather than a throw or a silently shorter buffer.
 *
 * Spaces, hyphens, lower case and `=` padding are accepted because screen TF1 prints the secret in
 * groups of four for a human to copy, and refusing their own formatting back is not a security
 * control. A character outside the alphabet is a different thing and is refused.
 */
export function base32Decode(value: string): Buffer | null {
  const cleaned = value.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (cleaned.length === 0) return null;

  const bytes: number[] = [];
  let bits = 0;
  let acc = 0;

  for (const character of cleaned) {
    const index = ALPHABET.indexOf(character);
    if (index === -1) return null;
    acc = (acc << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((acc >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  // Whatever is left is the encoder's left-aligned remainder and must be zero; anything else is a
  // truncated or mangled secret, which would verify against nothing and is better reported here.
  if (bits >= 5 || (acc & ((1 << bits) - 1)) !== 0) return null;
  return Buffer.from(bytes);
}

export const generateTotpSecret = (): string => base32Encode(crypto.randomBytes(TOTP_SECRET_BYTES));

export const totpStep = (atMs: number): number => Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);

/** RFC 4226 §5.3: HMAC the counter, take the dynamic truncation, reduce to six digits. */
export function totpCodeAt(secretBase32: string, step: number): string {
  const key = base32Decode(secretBase32);
  if (!key) throw new Error('totpCodeAt: the secret is not base32');

  const counter = Buffer.alloc(8);
  // Two 32-bit halves: `writeBigUInt64BE` would need a BigInt for a value that never exceeds 2^53.
  counter.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  counter.writeUInt32BE(step >>> 0, 4);

  const digest = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    ((digest[offset + 1] as number) << 16) |
    ((digest[offset + 2] as number) << 8) |
    (digest[offset + 3] as number);

  return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
}

export interface TotpVerdict {
  ok: boolean;
  /** The step the code belonged to, for the caller to store as "already spent". */
  step: number | null;
}

const MISS: TotpVerdict = { ok: false, step: null };

/**
 * `afterStep` is the replay guard a 30-second window needs.
 *
 * RFC 6238 says nothing about reuse: a code read over someone's shoulder is valid until the step
 * rolls over, and ±1 step makes that up to 90 seconds. Refusing any step at or below the last one
 * this factor spent closes it, and costs one column `mfa_factors` already has.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  options: { atMs: number; afterStep?: number | null },
): TotpVerdict {
  const presented = code.trim();
  if (!/^\d{6}$/.test(presented)) return MISS;
  if (base32Decode(secretBase32) === null) return MISS;

  const current = totpStep(options.atMs);
  const floor = options.afterStep ?? null;
  const presentedBytes = Buffer.from(presented, 'ascii');

  // Every candidate in the window is compared, with no early exit, so the loop costs the same
  // whichever step matched — and `timingSafeEqualBuffers` keeps each comparison constant-time.
  let matched: number | null = null;
  for (let offset = -TOTP_WINDOW_STEPS; offset <= TOTP_WINDOW_STEPS; offset += 1) {
    const step = current + offset;
    const candidate = Buffer.from(totpCodeAt(secretBase32, step), 'ascii');
    if (timingSafeEqualBuffers(candidate, presentedBytes) && (floor === null || step > floor)) {
      matched = step;
    }
  }

  return matched === null ? MISS : { ok: true, step: matched };
}

/**
 * The `otpauth://` URI screen TF1 renders as a QR code.
 *
 * The label is `issuer:account` and both halves are percent-encoded: an account name containing a
 * colon would otherwise forge the issuer prefix and the authenticator would file the credential
 * under somebody else's name.
 */
export function otpauthUri(input: { secretBase32: string; accountName: string; issuer: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.accountName)}`;
  const query = new URLSearchParams({
    secret: input.secretBase32,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
