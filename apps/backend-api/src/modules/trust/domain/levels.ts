// M6 §4's ladder, as arithmetic. Levels 0 and 1 are M1's; 2 to 4 are this module's.
import { VERIFICATION_LEVELS } from '../../identity/index.js';

/**
 * The ladder, indexed so that the array position IS the numeric level the spec uses.
 *
 * Derived from identity's own enum rather than retyped: `verification_level_changes` stores numbers
 * and `users.verification_level` stores names, so this is the only place the two representations
 * meet. A second copy of the ladder is a copy that drifts, and the symptom of drift would be a user
 * granted the wrong level.
 */
export const LEVEL_NAMES: readonly string[] = VERIFICATION_LEVELS;

/** The first level this module may grant (§4): below it is identity's business alone. */
export const MIN_TRUST_LEVEL = 2;
export const IDENTITY_VERIFIED_LEVEL = 2;

export function levelNumber(name: string): number {
  const index = LEVEL_NAMES.indexOf(name);
  // Not `-1 → 0`: silently treating an unknown level as UNVERIFIED would downgrade a user on a
  // typo, and a downgrade is the one direction that costs them money.
  if (index < 0) throw new RangeError(`unknown verification level "${name}"`);
  return index;
}

export function levelName(level: number): string {
  const name = LEVEL_NAMES[level];
  if (name === undefined) throw new RangeError(`no verification level numbered ${String(level)}`);
  return name;
}

export interface IdentityFacts {
  /** A NIN or a BVN with a `verified_at` — §4 requires one, not both. */
  identifierVerified: boolean;
  livenessPassed: boolean;
}

/**
 * §4's level-2 rule, stated once.
 *
 * NIN *or* BVN, because Nigerian users overwhelmingly have one to hand and not always both, and
 * demanding both is a completion-rate tax with no proportionate fraud benefit. Liveness is not
 * optional either way: a matched number with no liveness check proves somebody typed a valid number,
 * not that they are the person behind it.
 */
export const earnedIdentityLevel = (facts: IdentityFacts): boolean =>
  facts.identifierVerified && facts.livenessPassed;
