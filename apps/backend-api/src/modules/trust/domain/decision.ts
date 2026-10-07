// What a provider's verdict means for the request row. Pure, because this is the one place the
// spec's rules about auto-approval live and they should be readable without a database.
import type {
  BankMatchCheckResult,
  BusinessCheckResult,
  CheckVerdict,
  IdentityCheckResult,
  LivenessCheckResult,
} from './provider.js';
import type { RejectionCode } from './rejection.js';
import type { VerificationRequestStatus } from '../infrastructure/postgres/schema/enums.js';

export interface OutcomeDecision {
  requestStatus: VerificationRequestStatus;
  /**
   * Whether the outcome row gets a `verified_at`.
   *
   * This is the lever on the §6.3 partial unique index, so it is a decision rather than a
   * consequence: an unapproved attempt must NOT claim the number, or a low-confidence result on
   * someone else's NIN would lock the rightful owner out of ever verifying it.
   */
  markVerified: boolean;
  /** Whether the request is finished. A non-terminal one is still the user's one in-flight slot. */
  terminal: boolean;
}

export function decideIdentityOutcome(verdict: CheckVerdict): OutcomeDecision {
  switch (verdict) {
    case 'PASSED':
      return { requestStatus: 'APPROVED', markVerified: true, terminal: true };
    case 'LOW_CONFIDENCE':
      // §7's posture, applied one level up from the duplicate case: a human decides, because the
      // false-positive cost of auto-rejecting a real person's real number is a support nightmare.
      return { requestStatus: 'MANUAL_REVIEW', markVerified: false, terminal: false };
    case 'FAILED':
      return { requestStatus: 'REJECTED', markVerified: false, terminal: true };
    case 'PENDING':
      // Not an answer. The provider has it; the expiry sweep is the floor underneath that (§6.2).
      return { requestStatus: 'PROVIDER_PENDING', markVerified: false, terminal: false };
  }
}

/**
 * Liveness, where the adapter returns two things that can disagree.
 *
 * `livenessPassed` is the claim that matters. A `PASSED` verdict carrying `livenessPassed: false`
 * is an adapter bug or a mapping bug, and the safe reading of it is the refusal — granting an
 * identity level on a selfie the provider said was not live is the exact failure M6 §4 added
 * liveness to prevent.
 */
export function decideLivenessOutcome(verdict: CheckVerdict, livenessPassed: boolean): OutcomeDecision {
  if (verdict === 'PASSED' && livenessPassed) {
    return { requestStatus: 'APPROVED', markVerified: true, terminal: true };
  }
  if (verdict === 'PENDING') {
    return { requestStatus: 'PROVIDER_PENDING', markVerified: false, terminal: false };
  }
  if (verdict === 'LOW_CONFIDENCE') {
    return { requestStatus: 'MANUAL_REVIEW', markVerified: false, terminal: false };
  }
  return { requestStatus: 'REJECTED', markVerified: false, terminal: true };
}

/**
 * The CAC check (§4's level-3 first half).
 *
 * The same shape as the identity decision with one addition the identity path does not need: a
 * provider can say `PASSED` about a registration that exists and is *not active*, or that does not
 * list the submitter as an officer. Both are real registrations and neither is a business this
 * person may trade as, so both are rejections rather than passes — and `decideIdentityOutcome`'s
 * verdict-only switch would have approved them.
 *
 * `officersMatch: undefined` is NOT treated as a failure. Several providers do not return officer
 * data at all (§8's table is honest about how much of the KYB suite is "implied, not confirmed"),
 * and refusing every business whose provider is quiet on the question would reject all of them.
 * Unknown goes to a human instead.
 */
export function decideBusinessOutcome(result: BusinessCheckResult): OutcomeDecision {
  if (result.verdict !== 'PASSED') return decideIdentityOutcome(result.verdict);
  if (result.cacStatus !== undefined && result.cacStatus.toLowerCase() !== 'active') {
    return { requestStatus: 'REJECTED', markVerified: false, terminal: true };
  }
  if (result.officersMatch === false) {
    return { requestStatus: 'REJECTED', markVerified: false, terminal: true };
  }
  if (result.officersMatch === undefined) {
    return { requestStatus: 'MANUAL_REVIEW', markVerified: false, terminal: false };
  }
  return { requestStatus: 'APPROVED', markVerified: true, terminal: true };
}

/**
 * The bank name-match (§4's level-3 second half), decided on `match_result` rather than the verdict.
 *
 * **`FUZZY_MATCH` is not a pass**, and this is the one judgment call in the file worth defending.
 * A near-miss between "TECHEDGE NIGERIA LTD" and "TECH EDGE NIG LIMITED" is almost certainly the
 * same business — and "almost certainly" is not the standard for the check that decides where money
 * leaves the platform to. §7's posture, applied here: a human decides, because both errors are
 * expensive and only one of them is reversible.
 *
 * It also means the level-3 fact (`businessBankMatched`) can key on `EXACT` alone, so no threshold
 * on `match_score` is load-bearing anywhere — which matters because no provider's score is
 * calibrated against another's.
 */
export function decideBankMatchOutcome(result: BankMatchCheckResult): OutcomeDecision {
  if (result.verdict === 'PENDING') {
    return { requestStatus: 'PROVIDER_PENDING', markVerified: false, terminal: false };
  }
  if (result.matchResult === 'EXACT' && result.verdict === 'PASSED') {
    return { requestStatus: 'APPROVED', markVerified: true, terminal: true };
  }
  if (result.matchResult === 'FUZZY_MATCH') {
    return { requestStatus: 'MANUAL_REVIEW', markVerified: false, terminal: false };
  }
  return { requestStatus: 'REJECTED', markVerified: false, terminal: true };
}

/**
 * The provider's answer onto a stored rejection code.
 *
 * Every one of these prefers the adapter's own `failureCode` and falls back to the least specific
 * honest code for the check. The fallbacks are not "unknown": VF1 and BVR1 both have to render
 * something, and a screen reading "verification failed, reason unavailable" is worse than one
 * naming the most common cause — provided the copy says "usually", which VF1's does.
 */
export const classifyIdentityFailure = (result: IdentityCheckResult): RejectionCode =>
  result.failureCode ?? (result.verdict === 'LOW_CONFIDENCE' ? 'NEEDS_HUMAN_REVIEW' : 'ID_NOT_FOUND');

export const classifyLivenessFailure = (result: LivenessCheckResult): RejectionCode =>
  result.failureCode ?? (result.verdict === 'LOW_CONFIDENCE' ? 'NEEDS_HUMAN_REVIEW' : 'LIVENESS_FAILED');

/**
 * Business failures, where the fallback has to look at the fields rather than only the verdict: an
 * inactive registration and a missing one produce different copy on BVR1, and the difference is the
 * whole reason the screen has a "Why" banner.
 */
export function classifyBusinessFailure(result: BusinessCheckResult): RejectionCode {
  if (result.failureCode) return result.failureCode;
  if (result.verdict === 'LOW_CONFIDENCE') return 'NEEDS_HUMAN_REVIEW';
  if (result.officersMatch === false) return 'CAC_OFFICER_MISMATCH';
  if (result.verdict === 'PASSED' && result.cacStatus !== undefined) return 'CAC_INACTIVE';
  return 'CAC_NOT_FOUND';
}

export function classifyBankMatchFailure(result: BankMatchCheckResult): RejectionCode {
  if (result.failureCode) return result.failureCode;
  if (result.matchResult === 'FUZZY_MATCH') return 'NEEDS_HUMAN_REVIEW';
  // No resolved name at all means the bank did not recognise the account; a resolved name that did
  // not match means the account is real and belongs to somebody else.
  return result.resolvedAccountName === undefined ? 'BANK_ACCOUNT_NOT_FOUND' : 'BANK_NAME_MISMATCH';
}
