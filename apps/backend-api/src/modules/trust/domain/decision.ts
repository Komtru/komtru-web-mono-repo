// What a provider's verdict means for the request row. Pure, because this is the one place the
// spec's rules about auto-approval live and they should be readable without a database.
import type { CheckVerdict } from './provider.js';
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
