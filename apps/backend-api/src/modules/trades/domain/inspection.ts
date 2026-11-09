// Inspection and grace rules, pure (T-065): when the window or the grace period may act (AR1,
// M7 §6) and what a request for more inspection time (BEI1) may ask for. The services in
// services/inspection*.ts only gather the facts and carry out the answer.
import { z } from 'zod';
import type { TradeStatus } from './stateMachine.js';

const HOUR_MS = 3_600_000;

/** Both clocks stop for the same two reasons (design §6.2: holds freeze automatic transitions). */
interface Facts {
  status: TradeStatus;
  hasActiveHold: boolean;
  /** SEAM(T-080): the dispute service answers this; until it exists the port says no. */
  hasOpenDispute: boolean;
}

export type InspectionDecision = 'COMPLETE' | 'WAIT' | 'CLOSE_MET' | 'CLOSE_CANCELLED';

/**
 * AR1: what to do with an inspection deadline whose time has come.
 *
 * - Already COMPLETED or SETTLED: the deadline was met or moot, whatever else is going on.
 * - Anywhere but INSPECTION: close it as cancelled; someone else owns the trade now.
 * - A hold or an open dispute: not yet. The row stays pending and the next sweep looks again.
 * - Otherwise the window elapsed with the buyer silent: complete.
 */
export function decideInspectionElapsed(facts: Facts): InspectionDecision {
  if (facts.status === 'COMPLETED' || facts.status === 'SETTLED') return 'CLOSE_MET';
  if (facts.status !== 'INSPECTION') return 'CLOSE_CANCELLED';
  if (facts.hasActiveHold || facts.hasOpenDispute) return 'WAIT';
  return 'COMPLETE';
}

export type GraceDecision = 'CONVERT' | 'WAIT' | 'CLOSE_MET' | 'CLOSE_CANCELLED';

/**
 * M7 §6: an unconfirmed delivery whose grace period passed with no dispute becomes a confirmed one.
 * A trade that has already reached or passed INSPECTION means the buyer confirmed first.
 */
export function decideGraceElapsed(facts: Facts): GraceDecision {
  if (facts.status === 'INSPECTION' || facts.status === 'COMPLETED' || facts.status === 'SETTLED') {
    return 'CLOSE_MET';
  }
  if (facts.status !== 'UNCONFIRMED_DELIVERY') return 'CLOSE_CANCELLED';
  if (facts.hasActiveHold || facts.hasOpenDispute) return 'WAIT';
  return 'CONVERT';
}

export type InspectionExtensionCheck =
  { ok: true } | { ok: false; code: 'ALREADY_ELAPSED' | 'NOT_POSITIVE' | 'TOO_LONG' };

/**
 * BEI1: the buyer asks for more time, once, before the window passes. The window can only grow, and
 * by at most one original window: an owner-confirmable default (plan, open question 4) so a buyer
 * cannot buy open-ended time with the seller's money. "Once" is the caller's, and the database's.
 */
export function validateInspectionExtension(input: {
  now: Date;
  dueAt: Date;
  windowHours: number;
  extraHours: number;
}): InspectionExtensionCheck {
  if (input.dueAt.getTime() <= input.now.getTime()) return { ok: false, code: 'ALREADY_ELAPSED' };
  if (!Number.isInteger(input.extraHours) || input.extraHours < 1) return { ok: false, code: 'NOT_POSITIVE' };
  if (input.extraHours > input.windowHours) return { ok: false, code: 'TOO_LONG' };
  return { ok: true };
}

export const extendedInspectionDeadline = (dueAt: Date, extraHours: number): Date =>
  new Date(dueAt.getTime() + extraHours * HOUR_MS);

/** The one statement Z5 asks the buyer to accept; the code is stored with the acknowledgement. */
export const RELEASE_ACKNOWLEDGEMENT = 'RELEASE_IS_FINAL_V1';

/** Z5: "explicit acknowledgment before the irreversible action". Nothing but literal `true` counts. */
export const confirmReleaseBodySchema = z.object({ acknowledged: z.literal(true) });

// ---------------------------------------------------------------------------
// The inspection reminder (T-068)
// ---------------------------------------------------------------------------

/** The most notice a buyer is given: a day before the window closes. */
export const REMINDER_LEAD_CAP_HOURS = 24;

/**
 * A day, or half the window if the window is shorter than two days, so a short window is reminded
 * part-way through rather than the moment it opens. At least one hour.
 */
export const reminderLeadHours = (windowHours: number): number =>
  Math.max(1, Math.min(REMINDER_LEAD_CAP_HOURS, Math.floor(windowHours / 2)));

export type ReminderDecision = 'REMIND' | 'NOT_YET' | 'SKIP';

/**
 * Whether the one reminder for an inspection deadline is due.
 *
 * - `SKIP`: it will never be due on this row: the trade left INSPECTION, a reminder was already sent
 *   for this deadline, or a hold or open dispute means the buyer cannot confirm (a reminder to act in
 *   a window they cannot act in would be wrong). A hold that lifts before the deadline lets a later
 *   sweep send it, because the row stays unreminded.
 * - `NOT_YET`: too early, or the deadline has passed (the auto-release sweep owns that moment).
 */
export function decideInspectionReminder(
  facts: Facts & { alreadyReminded: boolean; dueAt: Date; now: Date; windowHours: number },
): ReminderDecision {
  if (facts.status !== 'INSPECTION') return 'SKIP';
  if (facts.alreadyReminded || facts.hasActiveHold || facts.hasOpenDispute) return 'SKIP';
  const remaining = facts.dueAt.getTime() - facts.now.getTime();
  if (remaining <= 0) return 'NOT_YET';
  return remaining <= reminderLeadHours(facts.windowHours) * HOUR_MS ? 'REMIND' : 'NOT_YET';
}
