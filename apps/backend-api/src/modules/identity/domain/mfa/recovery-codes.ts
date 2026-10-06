// Screen TF2's backup codes: ten of them, printed once, each good for one use.
//
// They live in ONE `mfa_factors` row of type RECOVERY_CODE rather than ten, so `GET /me/mfa/factors`
// reads as a list of factors and not a list of codes, and so spending one is a single row lock. The
// row's `secret_enc` holds this blob sealed (§S9); the blob itself holds HMACs, so a decrypted
// column is still not a list of codes.
import crypto from 'node:crypto';
import type { HmacHasher } from '../../../../platform/crypto/hmac.js';

export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_GROUP = 4;

/** Separate from the OTP and destination domains: a leaked digest must not confirm a guess elsewhere. */
export const RECOVERY_CODE_DOMAIN = 'identity.mfa.recovery_code';

/**
 * Crockford-ish: no `I` and no `O`, because a backup code is read off a screen and typed back months
 * later and `I`/`1` and `O`/`0` are the two mistakes everybody makes. 32 characters over 8 positions
 * is 40 bits, which is not guessable inside the rate limit and is short enough to write down.
 */
const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** `randomInt` and not `randomBytes % 34`: 256 is not a multiple of 34, and the bias is free to avoid. */
const drawCode = (): string => {
  let out = '';
  for (let i = 0; i < RECOVERY_CODE_GROUP * 2; i += 1) {
    out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return `${out.slice(0, RECOVERY_CODE_GROUP)}-${out.slice(RECOVERY_CODE_GROUP)}`;
};

export function generateRecoveryCodes(): string[] {
  const codes = new Set<string>();
  // Duplicates are astronomically unlikely and would silently make a set of ten into a set of nine.
  while (codes.size < RECOVERY_CODE_COUNT) codes.add(drawCode());
  return [...codes];
}

/**
 * The code as it is hashed, whatever the user typed.
 *
 * Case, spaces, hyphens and underscores are all stripped and the canonical hyphen re-inserted, so
 * `7k2m9pqx` and `7K2M-9PQX` are the same secret. A length that does not split evenly is left as it
 * is and simply matches nothing — this function normalises, it does not validate.
 */
export function normaliseRecoveryCode(value: string): string {
  const bare = value.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
  if (bare.length !== RECOVERY_CODE_GROUP * 2) return bare;
  return `${bare.slice(0, RECOVERY_CODE_GROUP)}-${bare.slice(RECOVERY_CODE_GROUP)}`;
}

export interface RecoveryCodeEntry {
  /** Hex HMAC of the normalised code under `RECOVERY_CODE_DOMAIN`. */
  h: string;
  /** ISO timestamp, or null while the code is unspent. */
  usedAt: string | null;
}

export interface RecoveryCodeBlob {
  v: 1;
  codes: RecoveryCodeEntry[];
}

export const buildRecoveryBlob = (hasher: HmacHasher, codes: string[]): RecoveryCodeBlob => ({
  v: 1,
  codes: codes.map((code) => ({
    h: hasher.hmac(RECOVERY_CODE_DOMAIN, normaliseRecoveryCode(code)).toString('hex'),
    usedAt: null,
  })),
});

const isEntry = (value: unknown): value is RecoveryCodeEntry => {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.h === 'string' && (entry.usedAt === null || typeof entry.usedAt === 'string');
};

/** `null` for anything this file did not write, so a corrupt column is a clean failure and not a crash. */
export function parseRecoveryBlob(json: string): RecoveryCodeBlob | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const blob = parsed as Record<string, unknown>;
  if (blob.v !== 1 || !Array.isArray(blob.codes) || !blob.codes.every(isEntry)) return null;
  return { v: 1, codes: blob.codes };
}

export const remainingRecoveryCodes = (blob: RecoveryCodeBlob): number =>
  blob.codes.filter((entry) => entry.usedAt === null).length;

/**
 * The blob to write back, or `null` when no unspent code matches.
 *
 * Returns a new blob and never touches the caller's: a function that marked the entry in place and
 * then reported a miss would spend a code on a failed attempt.
 */
export function spendRecoveryCode(
  hasher: HmacHasher,
  blob: RecoveryCodeBlob,
  code: string,
  atMs: number,
): RecoveryCodeBlob | null {
  const normalised = normaliseRecoveryCode(code);
  if (normalised.length === 0) return null;
  const digest = hasher.hmac(RECOVERY_CODE_DOMAIN, normalised);

  let spent = false;
  const codes = blob.codes.map((entry) => {
    if (spent || entry.usedAt !== null) return entry;
    // Constant-time: the digests are the same length, and a short-circuit comparison over ten
    // entries is a (very weak) oracle for how far down the list a guess landed.
    const stored = Buffer.from(entry.h, 'hex');
    if (stored.length !== digest.length || !crypto.timingSafeEqual(stored, digest)) return entry;
    spent = true;
    return { h: entry.h, usedAt: new Date(atMs).toISOString() };
  });

  return spent ? { v: 1, codes } : null;
}
