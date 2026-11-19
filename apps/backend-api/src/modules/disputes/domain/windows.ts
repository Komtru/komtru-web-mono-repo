// The three clocks a dispute runs on, as arithmetic. Pure: every function takes `now`, so nothing
// here reads the system clock and every boundary case is a plain unit test.
//
// THE BOUNDARY RULE, STATED ONCE: a deadline is exclusive. At the deadline instant the window is
// already shut. Applied identically to all three windows, because "did I make it?" answered
// differently by the mediation sweep and the evidence endpoint is the kind of disagreement that
// shows up as a party losing a case by a millisecond.
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const assertWholePositive = (value: number, unit: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`disputes: a window must be a positive whole number of ${unit}, got ${value}`);
  }
};

/** C13's mediation window, run from when the case opened (`disputes.mediation_window_hours`). */
export function mediationDeadline(openedAt: Date, hours: number): Date {
  assertWholePositive(hours, 'hours');
  return new Date(openedAt.getTime() + hours * MS_PER_HOUR);
}

/**
 * M3 D2's evidence window (`disputes.evidence_window_days`). One deadline for the case, not one per
 * party: the asymmetry D2 forbids is impossible to express here.
 */
export function evidenceDeadline(openedAt: Date, days: number): Date {
  assertWholePositive(days, 'days');
  return new Date(openedAt.getTime() + days * MS_PER_DAY);
}

/** M3 D5's appeal window, run from the decision rather than the opening. */
export function appealDeadline(decidedAt: Date, days: number): Date {
  assertWholePositive(days, 'days');
  return new Date(decidedAt.getTime() + days * MS_PER_DAY);
}

/** Exclusive: the deadline instant itself is already past. */
export const isPast = (deadline: Date, now: Date): boolean => now.getTime() >= deadline.getTime();

export interface Remaining {
  hours: number;
  minutes: number;
  expired: boolean;
}

/**
 * What a countdown strip shows (Y1's "31h", Seller-7's "24h", CWT-S18's "22h 40m"). Floored to the
 * minute rather than rounded up, so the strip never promises a minute the window does not have, and
 * clamped at zero so an overdue case reads as finished instead of counting backwards.
 */
export function remaining(deadline: Date, now: Date): Remaining {
  const left = deadline.getTime() - now.getTime();
  if (left <= 0) return { hours: 0, minutes: 0, expired: true };
  return {
    hours: Math.floor(left / MS_PER_HOUR),
    minutes: Math.floor((left % MS_PER_HOUR) / MS_PER_MINUTE),
    expired: false,
  };
}

/**
 * M3 D2 on late evidence: it is neither auto-accepted nor auto-rejected. Inside the window it is
 * simply evidence; outside it, it exists only because the assigned reviewer reopened collection,
 * and it is stored flagged so the decision log can show what arrived late.
 */
export type EvidenceAcceptance = 'IN_WINDOW' | 'LATE_REOPENED' | 'REFUSED';

export function evidenceAcceptance(input: {
  deadline: Date;
  now: Date;
  collectionReopened: boolean;
}): EvidenceAcceptance {
  if (!isPast(input.deadline, input.now)) return 'IN_WINDOW';
  return input.collectionReopened ? 'LATE_REOPENED' : 'REFUSED';
}
