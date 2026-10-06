// §S5's throttle, as pure arithmetic.
//
// This is `user_credentials.locked_until`, which clears itself and involves no human. It is NOT
// `users.status = 'LOCKED'`, which is a risk lock needing the §S7 recovery flow — M1 §9.1 says in so
// many words not to conflate them, and a service that sets the status from here is the bug it means.
export const LOCKOUT_THRESHOLD = 10;
export const LOCKOUT_BASE_MINUTES = 15;

/**
 * "Exponential thereafter" with no ceiling reaches years by the fortieth failure, and M1 is explicit
 * that a permanent lockout is a denial-of-service vector against your own users. A day is long
 * enough that no attacker is grinding through it and short enough that a real user gets back in
 * without a support ticket.
 */
export const LOCKOUT_CAP_MINUTES = 1440;

/** How long a lock should last after `failedAttempts` consecutive failures. 0 means no lock. */
export const lockoutMinutes = (failedAttempts: number): number => {
  if (!Number.isFinite(failedAttempts) || failedAttempts < LOCKOUT_THRESHOLD) return 0;

  // The exponent is clamped before it is raised: `2 ** 1_000_000` is Infinity, and `Math.min` of
  // Infinity and the cap is the cap only because Infinity is comparable — it is cheaper and clearer
  // to never produce it.
  const steps = Math.min(Math.floor(failedAttempts) - LOCKOUT_THRESHOLD, 32);
  return Math.min(LOCKOUT_CAP_MINUTES, LOCKOUT_BASE_MINUTES * 2 ** steps);
};

/** The timestamp to write to `user_credentials.locked_until`, or null when there is no lock. */
export const lockedUntil = (failedAttempts: number, now: Date): Date | null => {
  const minutes = lockoutMinutes(failedAttempts);
  return minutes === 0 ? null : new Date(now.getTime() + minutes * 60_000);
};
