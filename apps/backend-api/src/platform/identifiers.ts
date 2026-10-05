// Cannibalized from kumtru/backend-apis/src/modules/identity/domain/identifiers.ts (T-001), adapted:
// it lives at the platform root rather than under identity, because trades, logistics and
// notifications normalise the same identifiers, and a `+tag`-only local part is no longer folded
// away to an empty string.
//
// Identifier normalisation and masking (§D4, §5.4, §8.2). Every email and phone entering the system
// goes through here first: a STORED identifier is always in one canonical form, because uniqueness
// that depends on the caller having remembered to lowercase is not uniqueness.
import crypto from 'node:crypto';
import parsePhoneNumberFromString, { type CountryCode } from 'libphonenumber-js';

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/**
 * Deliberately permissive: real deliverability is proven by the OTP, not by a regex.
 *
 * The domain is checked by splitting on `.` and testing each label rather than with one pattern.
 * Every regex for "one or more dot-separated labels" contains a nested quantifier —
 * `(?:\.[^\s@.]+)+` — which backtracks catastrophically on a long non-matching input and turns a
 * public email field into a cheap CPU-exhaustion vector. A split-and-check loop is linear.
 */
const EMAIL_LOCAL_PATTERN = /^[^\s@]+$/;
const EMAIL_LABEL_PATTERN = /^[^\s@.]+$/;

const isValidEmailDomain = (domain: string): boolean => {
  const labels = domain.split('.');

  // A domain with no dot is not deliverable on the public internet, whatever the RFC permits.
  return labels.length >= 2 && labels.every((label) => EMAIL_LABEL_PATTERN.test(label));
};

/** Providers that ignore dots in the local part and treat `+tag` as an alias of the base address. */
const DOT_AND_PLUS_FOLDING_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/** Providers that alias `+tag` only. */
const PLUS_FOLDING_DOMAINS = new Set([
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'protonmail.com',
  'proton.me',
  'icloud.com',
  'fastmail.com',
]);

export interface NormalisedEmail {
  /** Exactly what the user typed, lowercased. This is what we display and what we send to. */
  email: string;
  /**
   * Provider-normalised form, for DUPLICATE DETECTION ONLY.
   *
   * The verified-email unique index covers this column, not `email`. Without it, `j.ane@gmail.com`
   * and `jane@gmail.com` verify onto two separate accounts and both users believe they control the
   * inbox — which they do, which is the problem.
   *
   * Never send mail to this value: `jane+komtru@gmail.com` folds to `jane@gmail.com`, and silently
   * rewriting a user's address is its own bug.
   */
  emailNormal: string;
  domain: string;
}

export const isValidEmail = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;

  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return false;

  return EMAIL_LOCAL_PATTERN.test(trimmed.slice(0, at)) && isValidEmailDomain(trimmed.slice(at + 1));
};

export const normaliseEmail = (raw: string): NormalisedEmail => {
  // Validate before canonicalising, not alongside it: `emailNormal` is what the verified-email
  // unique index covers, so an undeliverable string must not reach that column because a call site
  // forgot the separate `isValidEmail` call.
  if (!isValidEmail(raw)) throw new Error('Cannot normalise a value that is not an email address');

  const trimmed = raw.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  let normalLocal = local;

  if (DOT_AND_PLUS_FOLDING_DOMAINS.has(domain) || PLUS_FOLDING_DOMAINS.has(domain)) {
    // `> 0`, not `>= 0`: a local part that is entirely a tag has no base address to fold onto, and
    // folding it to '' would collide every such address on the provider into one row.
    const plus = normalLocal.indexOf('+');
    if (plus > 0) normalLocal = normalLocal.slice(0, plus);
  }

  if (DOT_AND_PLUS_FOLDING_DOMAINS.has(domain)) {
    const withoutDots = normalLocal.replace(/\./g, '');
    if (withoutDots.length > 0) normalLocal = withoutDots;
  }

  // Gmail and googlemail are the same mailbox; fold the domain too or the index misses.
  const normalDomain = domain === 'googlemail.com' ? 'gmail.com' : domain;

  return { email: trimmed, emailNormal: `${normalLocal}@${normalDomain}`, domain };
};

/**
 * Apple private-relay addresses are real and deliverable, but they are not a stable personal address:
 * the user can sever one at any time from iOS settings, which would strand account recovery. Seller
 * activation must therefore prompt for a direct address first.
 */
export const isApplePrivateRelay = (email: string): boolean =>
  email.trim().toLowerCase().endsWith('@privaterelay.appleid.com');

/** `jane@gmail.com` -> `j•••@gmail.com`. Enough for the owner to recognise, useless to an attacker. */
export const maskEmail = (email: string): string => {
  // Trimmed and lowercased first, or an untrimmed address reveals its leading space as the initial.
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0) return '•••';

  return `${value.slice(0, 1)}•••${value.slice(at)}`;
};

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

export const DEFAULT_COUNTRY: CountryCode = 'NG';

/** Numbers unused for this long must be re-verified — SIM recycling in Nigeria is real. */
export const PHONE_REVERIFY_AFTER_DAYS = 365;

export interface NormalisedPhone {
  /** `+2348012345678`. The ONLY format ever stored. */
  phoneE164: string;
  /**
   * ISO 3166-1 alpha-2, e.g. `NG`. Absent for a valid non-geographic number (`+800` international
   * toll-free and friends): defaulting those to the caller's country would store a fact that is
   * simply wrong, which is worse than storing nothing.
   */
  countryCode?: string;
}

/**
 * Parses and normalises a phone number to E.164.
 *
 * Returns `null` rather than throwing, because "the user typed a bad number" is an ordinary
 * validation outcome and the caller decides the status code.
 */
export const normalisePhone = (
  raw: string,
  country: CountryCode = DEFAULT_COUNTRY,
): NormalisedPhone | null => {
  const parsed = parsePhoneNumberFromString(raw.trim(), country);

  if (!parsed || !parsed.isValid()) return null;

  return { phoneE164: parsed.number, ...(parsed.country ? { countryCode: parsed.country } : {}) };
};

/** Last four characters shown, at most seven leading ones, and never fewer than this many hidden. */
const PHONE_MASK_MIN_HIDDEN = 4;

/**
 * `+2348012345678` -> `+23480•••5678`.
 *
 * The leading run shrinks so that at least four characters are always hidden, rather than the lifted
 * fixed 7-and-4: 7 + 4 is the whole of an 11-character number and all but one of a 12-character one,
 * which is every US and Canadian number in E.164 — a mask that hides one digit is not a mask.
 */
export const maskPhone = (phoneE164: string): string => {
  const lead = Math.min(7, phoneE164.length - 4 - PHONE_MASK_MIN_HIDDEN);
  // Below three leading characters there is nothing left to recognise the number by.
  if (lead < 3) return '•••';

  return `${phoneE164.slice(0, lead)}•••${phoneE164.slice(-4)}`;
};

export const phoneReverifyAfter = (from: Date): Date =>
  new Date(from.getTime() + PHONE_REVERIFY_AFTER_DAYS * 24 * 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Public id
// ---------------------------------------------------------------------------

/**
 * Crockford base32 minus the characters that get misread aloud or in print (I, L, O, U). A support
 * agent reads these to a user over the phone; `KMT-U-1IL0O` does not survive that.
 */
const PUBLIC_ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PUBLIC_ID_LENGTH = 6;

/**
 * Human-facing stable reference, e.g. `KMT-U-7F3K9Q`.
 *
 * Random rather than sequential: a sequential public id leaks total user count and growth rate, and
 * makes `GET /admin/users/KMT-U-000042` a working enumeration walk. Collisions are handled by the
 * UNIQUE constraint and a retry at the call site, not by hoping.
 *
 * Six characters is ~30 bits, which is short enough to guess at scale: a public id identifies a row,
 * it never authorises access to one. Whichever ticket first inserts one owns the retry.
 */
export const generatePublicId = (prefix = 'KMT-U'): string => {
  let out = '';

  // Rejection-free: 32 divides 256 exactly, so a byte mod 32 is uniform.
  for (const byte of crypto.randomBytes(PUBLIC_ID_LENGTH)) {
    out += PUBLIC_ID_ALPHABET[byte % PUBLIC_ID_ALPHABET.length];
  }

  return `${prefix}-${out}`;
};

/**
 * Classifies whatever the client put in the single `identifier` field of `POST /auth/login`.
 *
 * Order matters: a LEADING `@` is the handle sigil, not an email separator, and is checked before
 * the `includes('@')` test — otherwise `@janedoe` is read as an email, fails to resolve, and leaves
 * the user staring at a uniform 401 for a handle that exists. A username can never start with a
 * digit or a bracket (§6.1), so phone and username do not overlap.
 */
export type IdentifierKind = 'EMAIL' | 'PHONE' | 'USERNAME';

export const classifyIdentifier = (raw: string): IdentifierKind => {
  const value = raw.trim();

  if (value.startsWith('@')) return 'USERNAME';
  if (value.includes('@')) return 'EMAIL';
  // `(` leads the class as well as appearing inside it: `(0801) 234-5678` is how a Nigerian number
  // is commonly written down, and the lifted pattern sent it to the username branch and a 401.
  if (/^[+(0-9][0-9\s()-]*$/.test(value)) return 'PHONE';

  return 'USERNAME';
};
