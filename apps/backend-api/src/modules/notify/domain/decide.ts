// Whether a notification is sent, suppressed, or escalated (M11 §5 and D2).
//
// Pure, and everything it needs is an argument: the one decision that must never be made by
// accident is "this user does not get told", and a function with no I/O is a function a test can
// pin every branch of.
//
// NOT HERE: quiet hours. M11 names preferences and the per-user cap as the only gates on a send,
// and neither it nor T-045 specifies a time-of-day window — how long a notification may be held,
// which categories escape, what happens to the backlog at the end of it. A quiet-hours rule that
// deferred a security message would be exactly the silent suppression D2 forbids, so inventing one
// without a spec is worse than not having it. The shape is ready for it when M17 (T-048) decides
// the rule.
import type { NotificationCategory } from '@komtru/shared-types';

export type SuppressionReason = 'PREFERENCE_OPT_OUT' | 'RATE_LIMITED' | 'NO_DESTINATION';

export type DeliveryDecision =
  | { kind: 'SEND' }
  | { kind: 'SUPPRESS'; reason: SuppressionReason }
  /**
   * Security-critical and nowhere to send it. Recorded DEAD_LETTERED and published, never quietly
   * suppressed: a user who cannot get their OTP is a user who is about to get locked out (M11 §5).
   */
  | { kind: 'UNDELIVERABLE' };

export interface DeliveryDecisionInput {
  /** The template's `is_security_critical`. M11 D2: bypasses preferences and the cap. */
  securityCritical: boolean;
  category: NotificationCategory;
  /** False when the user has no verified address (or no device) for this channel. */
  hasDestination: boolean;
  /** The user's preference for (category, channel); absent rows count as opted in (M11 §4.4). */
  optedIn: boolean;
  sendCountInWindow: number;
  maxPerWindow: number;
}

export function decideDelivery(input: DeliveryDecisionInput): DeliveryDecision {
  const { securityCritical, category, hasDestination, optedIn, sendCountInWindow, maxPerWindow } = input;

  if (!hasDestination) {
    return securityCritical ? { kind: 'UNDELIVERABLE' } : { kind: 'SUPPRESS', reason: 'NO_DESTINATION' };
  }
  if (securityCritical) return { kind: 'SEND' };
  if (!optedIn) return { kind: 'SUPPRESS', reason: 'PREFERENCE_OPT_OUT' };
  // The category check as well as the flag: M11 §5 exempts the SECURITY category from the cap, and
  // a template that lost its flag must still not have an OTP swallowed by a noisy hour.
  if (category !== 'SECURITY' && sendCountInWindow >= maxPerWindow) {
    return { kind: 'SUPPRESS', reason: 'RATE_LIMITED' };
  }
  return { kind: 'SEND' };
}

/**
 * The start of the fixed window a send at `now` falls in. Floored on the epoch rather than within
 * the hour, so windows that do not divide an hour still tile without a gap.
 */
export function rateLimitWindowStart(now: Date, windowMinutes: number): Date {
  const windowMs = windowMinutes * 60_000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}
