// M1 §5.8 / §11: how risky an account-recovery request looks, and when a human must look at it.
//
// "Account recovery is where social engineering lands; it should always have a human in the loop
// above a threshold." The score is deliberately a few additive facts rather than a model: it has to
// be explainable to the reviewer, and M13 (risk) can replace it later by publishing a better number.
import type { RecoveryMethod } from './events.js';

/**
 * Requests scoring above this need a human. Zero means every request does: no code path in this
 * build completes a recovery without a reviewer (plan, owner decision 7). Raising it only lets a
 * low-risk request wait for the existing OTP flow instead of the review queue.
 */
export const RECOVERY_HUMAN_REVIEW_THRESHOLD = 0;

/** How hard each loss is to prove, 0..100. Losing everything proves the least and risks the most. */
const METHOD_BASE: Record<RecoveryMethod, number> = {
  LOST_PASSWORD: 20,
  MFA_LOCKOUT: 40,
  LOST_PHONE: 50,
  LOST_DEVICE: 50,
  LOST_ALL: 70,
};

export interface RecoverySignals {
  method: RecoveryMethod;
  /** Did the requester attach any evidence (M20 files)? */
  hasEvidence: boolean;
  accountStatus: string;
  /** A staff account is a far more valuable target than a consumer one. */
  holdsStaffRole: boolean;
}

export function recoveryRiskScore(signals: RecoverySignals): number {
  let score = METHOD_BASE[signals.method];
  if (!signals.hasEvidence) score += 10;
  // A risk-locked account was locked for a reason; recovering it is the thing an attacker wants.
  if (signals.accountStatus === 'LOCKED') score += 10;
  if (signals.holdsStaffRole) score += 10;
  return Math.max(0, Math.min(100, score));
}

export const recoveryNeedsHuman = (
  score: number,
  threshold: number = RECOVERY_HUMAN_REVIEW_THRESHOLD,
): boolean => score > threshold;

/** A request not decided within this many days expires (M1 §5.8's `expires_at`). */
export const RECOVERY_REQUEST_TTL_DAYS = 7;
