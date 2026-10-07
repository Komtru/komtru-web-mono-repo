// The Instagram/X social-proof challenge: the pure half, and the seam the platform is reached
// through.
//
// M1 §7.2 is the design and it is unusual enough to restate: this is NOT OAuth and NOT login. The
// user tells us a handle, we give them a one-time code, they put it in their bio or post it, and we
// look for it. The code's job is to prove control of the account at a moment in time — anyone can
// type `@techedge_ng` into a form, only its owner can edit its bio.
//
// Three things follow from that, and all three are deliberate:
//
//  1. **The code is not a secret.** It is meant to be published. So it needs to be unguessable
//     enough that a third party cannot pre-publish someone else's code (hence `randomBytes`), and
//     short and unambiguous enough to retype from a phone (hence 8 characters from an alphabet with
//     no `0`/`O` or `1`/`I`).
//  2. **The claim expires.** A code that stays valid forever means a bio edited once, three months
//     ago, by someone who has since sold the account, still proves ownership today.
//  3. **The adapter is a port, not a vendor.** Neither platform is reachable the way a KYC provider
//     is — Instagram's Graph API needs a Professional account and a Meta app review, X charges per
//     read — so the one thing this module must not do is bake either one in.
import { randomBytes } from 'node:crypto';
import type { SocialProofPlatform } from '../infrastructure/postgres/schema/enums.js';

/**
 * No `0`/`O`, no `1`/`I`, no `5`/`S`. Typed off a screen into a phone, under a timer, by someone
 * whose income depends on getting it right.
 */
const ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY2346789';
const CODE_LENGTH = 8;
const PREFIX = 'KOMTRU-';

/**
 * How long a published code proves anything for.
 *
 * A day, matching `TRUST_REQUEST_TTL_MINUTES`'s default for the same reason: long enough that
 * somebody can do it this evening rather than this minute, short enough that a stale bio is not
 * standing evidence.
 */
export const SOCIAL_CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * `KOMTRU-XXXXXXXX`.
 *
 * Prefixed so that it is recognisable in a bio as something deliberate rather than noise — a seller
 * pasting it into their profile is showing it to their own customers, and an unlabelled string of
 * characters reads like a compromised account.
 *
 * `randomBytes` with a rejection-free mapping: 28 is not a divisor of 256, so a plain `% 28` would
 * make the first twelve letters of the alphabet very slightly likelier. It makes no practical
 * difference to a one-day code, and getting it right costs one loop.
 */
export function generateChallengeCode(): string {
  const out: string[] = [];
  while (out.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      if (out.length === CODE_LENGTH) break;
      // 252 = 28 * 9: everything above it is discarded rather than folded.
      if (byte >= 252) continue;
      out.push(ALPHABET[byte % ALPHABET.length] as string);
    }
  }
  return PREFIX + out.join('');
}

const HANDLE_MAX = 30;
const HANDLE_PATTERN = /^[a-z0-9._]+$/;

/**
 * A handle, normalised: no `@`, no surrounding whitespace, lower-cased.
 *
 * Both platforms are case-insensitive about handles, and a user will type `@TechEdge_NG` in one
 * place and `techedge_ng` in another. Without one normal form the unique index that stops two
 * sellers both wearing a verified `@techedge_ng` badge would not fire.
 */
export const normaliseHandle = (raw: string): string => raw.trim().replace(/^@+/, '').toLowerCase();

/**
 * Shape only, and strict here where the identifier validators are loose — because the point is the
 * opposite one.
 *
 * A malformed NIN might be a real number we failed to anticipate, so refusing it costs a real user
 * their verification. A handle containing `/` or a space cannot exist on either platform, so
 * accepting it costs us a provider lookup and the user a confusing failure.
 */
export const isValidHandle = (normalised: string): boolean =>
  normalised.length > 0 && normalised.length <= HANDLE_MAX && HANDLE_PATTERN.test(normalised);

/**
 * What a platform lookup can say.
 *
 * `NOT_FOUND` and `NO_CODE` are different answers to the user — "check the spelling" against "put
 * the code up and try again" — and collapsing them into a boolean is how a seller spends twenty
 * minutes editing a bio on an account whose handle they mistyped.
 */
export type SocialLookupOutcome = 'CODE_PRESENT' | 'NO_CODE' | 'NOT_FOUND' | 'INDETERMINATE';

export interface SocialLookupResult {
  outcome: SocialLookupOutcome;
  /**
   * Where the code was found, for the audit trail: `bio` or `post`.
   *
   * Never the profile's text itself. Storing somebody's bio because we happened to read it is
   * collecting personal data to answer a yes/no question, and the answer is the thing we need.
   */
  foundIn?: 'bio' | 'post';
}

export interface SocialProofAdapter {
  /** For the log line, and so a `MANUAL` deployment is visible in one grep. */
  readonly name: string;
  /**
   * Does `handle` on `platform` currently display `challengeCode`?
   *
   * The adapter is given the code and returns a verdict rather than returning the profile text for
   * this module to search. That keeps the one thing worth keeping — the answer — and leaves the
   * profile's contents inside the adapter where they are discarded.
   */
  lookup(input: {
    platform: SocialProofPlatform;
    handle: string;
    challengeCode: string;
  }): Promise<SocialLookupResult>;
}
