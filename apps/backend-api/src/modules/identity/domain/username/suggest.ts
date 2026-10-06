// M1 §6.5: when a handle is taken, offer alternatives built from what the user asked for.
//
// Pure and deterministic. Every candidate here has passed the format rule, the blocked-substring
// rule and skeleton-distinctness from the base and from its siblings; what it has NOT passed is the
// live uniqueness check, because that needs the database. The service filters this list against
// `users.username_skeleton` and `reserved_usernames` before returning any of it, which is also what
// satisfies §6.5's "never suggest something confusable with an existing high-reputation account":
// a candidate that collides with any existing account never survives that filter.
import { USERNAME_MAX_LENGTH, validateUsernameFormat } from './policy.js';
import { matchBlockedSubstring } from './reserved.js';
import { skeleton } from './skeleton.js';

/**
 * Suffixes that read as a storefront rather than as a second account of the same name.
 *
 * No `official`: the reserved namespace holds that word precisely because it implies endorsement
 * ("platform identity — impersonation risk"), and handing it out as a suggestion would be the
 * platform minting the impersonation it reserves the word to prevent.
 */
const WORD_SUFFIXES = ['ng', 'hq', 'store', 'shop', 'deals'] as const;

/** Numeric suffixes are tried in order; most are rejected, so the ceiling is generous. */
const MAX_NUMERIC_SUFFIX = 200;

export const suggestionCandidates = (base: string, limit = 3): string[] => {
  const validated = validateUsernameFormat(base);
  // An invalid base is a typo, not a collision. Suggesting variations of it would be answering a
  // question the user did not ask.
  if (!validated.ok) return [];

  const root = validated.username;
  const suggestions: string[] = [];
  // Seeded with the base's own fold: `dellstore` + `3` folds to `delstoree` and then back to
  // `delstore`, which is the very skeleton that was taken.
  const seen = new Set([skeleton(root)]);

  const offer = (suffix: string, separator: string): void => {
    if (suggestions.length >= limit) return;

    const candidate = `${root.slice(0, USERNAME_MAX_LENGTH - suffix.length - separator.length)}${separator}${suffix}`;
    if (!validateUsernameFormat(candidate).ok) return;
    if (matchBlockedSubstring(candidate)) return;

    const folded = skeleton(candidate);
    if (seen.has(folded)) return;

    seen.add(folded);
    suggestions.push(candidate);
  };

  for (const suffix of WORD_SUFFIXES) offer(suffix, '_');
  for (let n = 1; n <= MAX_NUMERIC_SUFFIX && suggestions.length < limit; n += 1) offer(String(n), '');

  return suggestions;
};
