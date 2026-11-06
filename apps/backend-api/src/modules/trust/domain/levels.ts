// M6 §4's ladder, as arithmetic. Levels 0 and 1 are M1's; 2 to 4 are this module's.
import { VERIFICATION_LEVELS, type VerificationLevelName } from '../../identity/index.js';
import type { LevelChangeDirection } from '../infrastructure/postgres/schema/enums.js';

/**
 * The ladder, indexed so that the array position IS the numeric level the spec uses.
 *
 * Derived from identity's own enum rather than retyped: `verification_level_changes` stores numbers
 * and `users.verification_level` stores names, so this is the only place the two representations
 * meet. A second copy of the ladder is a copy that drifts, and the symptom of drift would be a user
 * granted the wrong level.
 */
export const LEVEL_NAMES: readonly VerificationLevelName[] = VERIFICATION_LEVELS;

/** The first level this module may grant (§4): below it is identity's business alone. */
export const MIN_TRUST_LEVEL = 2;
export const IDENTITY_VERIFIED_LEVEL = 2;
export const BUSINESS_VERIFIED_LEVEL = 3;
/**
 * §4's level 4, reserved and deliberately not granted by anything in this module.
 *
 * "Enhanced due diligence" is a human compliance process, and the spec says outright that
 * over-specifying it now would guess at requirements that should come from a compliance function
 * that does not exist yet. A proof-of-address check declares this as its `target_level` because that
 * is the tier the evidence is FOR; no code path turns it into a grant.
 */
export const ENHANCED_LEVEL = 4;

/**
 * Takes a plain `string` on purpose: it is fed by `users.verification_level` read back out of the
 * database, which the type system cannot vouch for. The throw below is the check.
 */
export function levelNumber(name: string): number {
  const index = (LEVEL_NAMES as readonly string[]).indexOf(name);
  // Not `-1 → 0`: silently treating an unknown level as UNVERIFIED would downgrade a user on a
  // typo, and a downgrade is the one direction that costs them money.
  if (index < 0) throw new RangeError(`unknown verification level "${name}"`);
  return index;
}

/**
 * Typed as the literal union, not `string`.
 *
 * It feeds `applyVerificationLevel`, whose parameter is that union, and widening here would have
 * forced an `as never` at the call site — which is exactly the compile-time check that deriving this
 * ladder from identity's own enum was supposed to buy.
 */
export function levelName(level: number): VerificationLevelName {
  const name = LEVEL_NAMES[level];
  if (name === undefined) throw new RangeError(`no verification level numbered ${String(level)}`);
  return name;
}

export interface LevelChange {
  from: number;
  to: number;
  direction: LevelChangeDirection;
}

/**
 * Whether a level change should be written at all — asked BEFORE anything is written.
 *
 * An earlier version let the store move `users.verification_level` first and check afterwards, so a
 * redelivered level-2 grant reaching a BUSINESS_VERIFIED user wrote the downgrade, published it, and
 * then declined to append the audit row that would have explained it. That is the one thing an
 * append-only log must never permit: a level the log cannot account for.
 *
 * A GRANT therefore only ever moves UP and a REVOKE only ever moves DOWN. Anything else is a no-op,
 * which is also what makes both idempotent under BullMQ's at-least-once delivery.
 */
export function decideLevelChange(change: LevelChange): { apply: boolean } {
  if (change.direction === 'GRANT') return { apply: change.to > change.from };
  return { apply: change.to < change.from };
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

export interface BusinessFacts {
  /**
   * The user's level right now, read from `users.verification_level`.
   *
   * It is a parameter rather than something this function infers from the other two, because §4's
   * level-3 rule is "level 2 **plus** CAC plus bank match" and the level-2 half is not re-derivable
   * here: a user can hold a verified CAC and a matched business account while their identity level
   * has since been revoked (D6), and the honest answer then is no.
   */
  currentLevel: number;
  /** A `business_verifications` row with a `verified_at` — the CAC check passed. */
  cacVerified: boolean;
  /**
   * A `bank_account_name_matches` row whose result was `EXACT`, on an approved request.
   *
   * `FUZZY_MATCH` deliberately does not count. See `decideBankMatchOutcome`: a near-miss between a
   * registered business name and an account holder's name is exactly the ambiguity a human should
   * settle, and auto-granting a level on it is how a payout ends up going to a name nobody checked.
   */
  businessBankMatched: boolean;
}

/**
 * §4's level-3 rule, stated once: level 2, plus a CAC registration check, plus a business bank
 * account name-match.
 *
 * All three, and the first one is not a formality. A business is operated by a verified human, so a
 * user at level 1 holding a real CAC number must not jump to `BUSINESS_VERIFIED` — the CAC proves a
 * company exists, not that the person submitting it is who they say they are.
 */
export const earnedBusinessLevel = (facts: BusinessFacts): boolean =>
  facts.currentLevel >= IDENTITY_VERIFIED_LEVEL && facts.cacVerified && facts.businessBankMatched;
