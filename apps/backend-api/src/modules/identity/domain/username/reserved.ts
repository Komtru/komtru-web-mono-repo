// Cannibalized from kumtru/backend-apis/src/modules/identity/domain/username/reserved.ts (T-001),
// adapted: the seed data is unchanged, but the matching helpers below are new, because the lifted
// code folded only one side of every comparison. See `reservedSkeletonRows` and
// `blockedSubstringSkeletons` for what that let through.
import { skeletonVariants } from './skeleton.js';

/**
 * The reserved namespace (M1 §6.2).
 *
 * Reservation is matched against the SKELETON, not the literal string, so a single `admin` entry also
 * blocks `adm1n`, `a.d.m.i.n`, `admiiin` and `аdmin` with a Cyrillic а. That is the whole reason the
 * table's primary key is `username_skeleton`.
 *
 * This list is the seed, not the ceiling. Trust & Safety adds to `reserved_usernames` at runtime via
 * `POST /admin/usernames/reserve` (T-037's `username.reserve` permission); nothing here is hardcoded into a lookup path.
 */

export type ReservedCategory = 'SYSTEM' | 'MONEY' | 'TRUST' | 'PARTNER' | 'BRAND' | 'ROLE' | 'OFFENSIVE';

export interface ReservedSeed {
  /** The literal word. The seeder folds it to a skeleton before insert. */
  word: string;
  category: ReservedCategory;
  note?: string;
}

const group = (category: ReservedCategory, words: readonly string[], note?: string): ReservedSeed[] =>
  words.map((word) => ({ word, category, ...(note ? { note } : {}) }));

/**
 * Anything that could be read as "this account is Kumtru itself". The single highest-value
 * impersonation target on the platform.
 */
const SYSTEM = group(
  'SYSTEM',
  [
    'kumtru',
    'komtru',
    'kumtruapp',
    'komtruapp',
    'kumtruofficial',
    'komtruofficial',
    'admin',
    'administrator',
    'root',
    'system',
    'support',
    'help',
    'helpdesk',
    'security',
    'verify',
    'verified',
    'official',
    'staff',
    'api',
    'www',
    'mail',
    'ftp',
    'cdn',
    'status',
    'blog',
    'app',
    'dev',
    'test',
    'staging',
    'null',
    'undefined',
    'me',
    'you',
  ],
  'platform identity — impersonation risk',
);

/** Money words carry implied authority in an escrow flow: `@escrow` asking for a transfer works. */
const MONEY = group(
  'MONEY',
  [
    'escrow',
    'payment',
    'payments',
    'payout',
    'payouts',
    'refund',
    'refunds',
    'wallet',
    'billing',
    'finance',
    'settlement',
    'settlements',
    'invoice',
    'invoices',
    'bank',
    'transfer',
    'transfers',
    'deposit',
    'withdrawal',
  ],
  'implies financial authority',
);

const TRUST = group(
  'TRUST',
  [
    'kyc',
    'compliance',
    'moderator',
    'mod',
    'trust',
    'safety',
    'fraud',
    'dispute',
    'disputes',
    'appeal',
    'arbitration',
  ],
  'implies moderation authority',
);

/**
 * Payment processors, banks and logistics partners. Extend this the moment a new partner brand is
 * integrated — an impersonated `@paystack` in a transaction thread is a working phishing attack.
 */
const PARTNER = group(
  'PARTNER',
  [
    'paystack',
    'flutterwave',
    'gtbank',
    'zenith',
    'accessbank',
    'firstbank',
    'uba',
    'opay',
    'palmpay',
    'moniepoint',
    'kuda',
    'interswitch',
    'remita',
    'gig',
    'gigl',
    'dhl',
    'fedex',
    'ups',
    'kwik',
    'sendbox',
  ],
  'partner or integrated brand',
);

const ROLE = group(
  'ROLE',
  ['agent', 'operator', 'reviewer', 'analyst', 'auditor', 'officer'],
  'staff-sounding',
);

export const RESERVED_USERNAME_SEED: readonly ReservedSeed[] = Object.freeze([
  ...SYSTEM,
  ...MONEY,
  ...TRUST,
  ...PARTNER,
  ...ROLE,
]);

/**
 * Terms rejected wherever they appear, not just as a whole handle — checked by substring against the
 * skeleton, unlike `reserved_usernames`, which is an exact skeleton match.
 *
 * Kept short on purpose. A long substring blocklist generates false positives at a rate that costs
 * more in support load than it saves in abuse (the `scunthorpe` problem), so this is limited to terms
 * that impersonate the platform or a payment instrument.
 *
 * The profanity and hate-speech list is deliberately NOT hardcoded here: it is locale-specific,
 * changes constantly and belongs in `reserved_usernames` with `category = 'OFFENSIVE'` where Trust &
 * Safety can edit it without a deploy.
 */
export const BLOCKED_SUBSTRING_SEED: readonly string[] = Object.freeze([
  /**
   * The platform name itself, ANYWHERE in the handle.
   *
   * This is broader than the other entries on purpose. `@komtru` alone being reserved still leaves
   * `@komtru_ng`, `@komtrustore`, `@mykomtru` and `@komtruofficial` claimable — and a handle whose only
   * value is that it looks official is exactly what an impersonator wants. Blocking the substring costs
   * a handful of false positives (a user genuinely called Komtru) that Trust & Safety can release
   * individually via `releasable`, which is a far better trade than the alternative.
   */
  'komtru',
  'kumtru',

  // Platform-role compounds, kept explicit so the intent survives if the entries above are ever
  // narrowed.
  'officialsupport',
  'officialescrow',
  'escrowsupport',
  'paymentsupport',
]);

/** One `reserved_usernames` row: the table's primary key is the skeleton, not the word. */
export interface ReservedSkeletonRow {
  usernameSkeleton: string;
  category: ReservedCategory;
  note?: string;
}

/**
 * Every fold of every seed word, deduplicated, ready to insert.
 *
 * One row per *fold*, not per word. The lifted code stored only the canonical skeleton and relied on
 * `skeletonVariants(candidate)` to bridge the gap, which silently fails whenever the reserved word
 * itself folds differently under the two algorithms: `skeleton('flutterwave')` is `fluterwave` and
 * `skeletonNarrow('fiutterwave')` is `fiuterwave`, so neither fold of the attacker's handle ever
 * meets the one stored row and `@fiutterwave` was claimable. Folding both sides is the fix, and
 * storing the extra rows keeps the lookup a single indexed `= ANY(...)`.
 *
 * The first category to claim a skeleton wins; a later word folding onto it is a duplicate, not a
 * recategorisation.
 */
export const reservedSkeletonRows = (): ReservedSkeletonRow[] => {
  const rows = new Map<string, ReservedSkeletonRow>();

  for (const seed of RESERVED_USERNAME_SEED) {
    for (const value of skeletonVariants(seed.word)) {
      if (value.length === 0 || rows.has(value)) continue;
      rows.set(value, {
        usernameSkeleton: value,
        category: seed.category,
        ...(seed.note ? { note: seed.note } : {}),
      });
    }
  }

  return [...rows.values()];
};

/**
 * The blocked substrings, folded.
 *
 * A raw seed cannot match: the terms are matched against a skeleton, and run collapsing means no
 * skeleton ever contains `officialsupport` — it contains `oficialsuport`. Three of the four compound
 * entries therefore never fired in the lifted code.
 */
export const blockedSubstringSkeletons = (): string[] => {
  const folded = new Set<string>();

  for (const term of BLOCKED_SUBSTRING_SEED) {
    for (const value of skeletonVariants(term)) if (value.length > 0) folded.add(value);
  }

  return [...folded];
};

/**
 * The first blocked term contained in any fold of `username`, or undefined.
 *
 * Substring rather than exact match, unlike `reserved_usernames`: `@komtru_ng` and `@mykomtru` are
 * worth as much to an impersonator as `@komtru` itself.
 */
export const matchBlockedSubstring = (username: string): string | undefined => {
  const candidates = skeletonVariants(username);

  for (const term of BLOCKED_SUBSTRING_SEED) {
    for (const folded of skeletonVariants(term)) {
      if (folded.length > 0 && candidates.some((candidate) => candidate.includes(folded))) return folded;
    }
  }

  return undefined;
};
