// M1 §6.1 and §6.4: the format and change rules, as pure functions over a string.
//
// The database CHECK (`^[a-z][a-z0-9._]{2,29}$`, cast to text so citext does not fold case in `~`)
// is deliberately looser than this — it is a backstop that catches a bug in this file, not the
// policy. Everything a user is allowed to claim has to pass here first.

/**
 * `^[a-z]` first character a letter, `[a-z0-9]$` last character alphanumeric, and a separator only
 * where a lookahead proves an alphanumeric follows — which is what rejects `a__b` and `a._b`
 * without a second pass. 1–28 middle characters give the 3–30 total.
 *
 * "Digits-only rejected" needs no branch of its own: a handle that must start with a letter cannot
 * be all digits.
 */
export const USERNAME_PATTERN = /^[a-z](?:[a-z0-9]|[._](?=[a-z0-9])){1,28}[a-z0-9]$/;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

/** M1 §6.4. */
export const CHANGE_COOLDOWN_DAYS = 30;
export const LIFETIME_CHANGE_CAP = 3;
export const QUARANTINE_DAYS = 90;
export const OWNER_RECLAIM_DAYS = 30;

/**
 * M1 §6.4's "level ≥ 2 sellers". The spec numbers verification levels; the schema names them, and
 * these are the three at or above identity verification.
 */
export const SUPPORT_APPROVAL_LEVELS = ['IDENTITY_VERIFIED', 'BUSINESS_VERIFIED', 'ENHANCED'] as const;

/**
 * What a user typed, reduced to the one canonical form that is stored and compared.
 *
 * NFKC before lowercasing, so a fullwidth or styled paste from a phone keyboard is accepted rather
 * than rejected as non-ASCII. Exactly one leading `@` is stripped — it is the handle sigil, and
 * `classifyIdentifier` in src/platform/identifiers.ts reads it the same way — but not two, because
 * `@@jane` is a typo we should reject rather than silently reinterpret.
 */
export const normaliseUsername = (raw: string): string => {
  const trimmed = raw.normalize('NFKC').trim();
  return (trimmed.startsWith('@') ? trimmed.slice(1) : trimmed).toLowerCase();
};

export type UsernameFormatProblem = 'TOO_SHORT' | 'TOO_LONG' | 'NON_ASCII' | 'INVALID_FORMAT';

export type UsernameFormatResult =
  { ok: true; username: string } | { ok: false; problem: UsernameFormatProblem };

// eslint-disable-next-line no-control-regex -- the point is to detect anything outside ASCII.
const ASCII_ONLY = /^[\x00-\x7F]*$/;

/**
 * Length is measured in code points, not UTF-16 units, so an astral character counts once — it is
 * rejected as non-ASCII a line later either way, but a length answer that depends on the encoding
 * is the kind of thing that stops being true when the ASCII rule is relaxed.
 */
export const validateUsernameFormat = (raw: string): UsernameFormatResult => {
  const username = normaliseUsername(raw);
  const length = [...username].length;

  if (length < USERNAME_MIN_LENGTH) return { ok: false, problem: 'TOO_SHORT' };
  if (length > USERNAME_MAX_LENGTH) return { ok: false, problem: 'TOO_LONG' };
  // Before the pattern, so a user pasting `josé` is told their handle has characters we cannot take
  // rather than that it is malformed (M1 §6.3: reject non-ASCII outright at launch).
  if (!ASCII_ONLY.test(username)) return { ok: false, problem: 'NON_ASCII' };
  if (!USERNAME_PATTERN.test(username)) return { ok: false, problem: 'INVALID_FORMAT' };

  return { ok: true, username };
};
