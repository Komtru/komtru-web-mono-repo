// The three clocks a dispute runs on: C13's mediation window, M3 D2's evidence window and M3 D5's
// appeal window. Pure — every function takes `now` as an argument, so none of this needs a fake
// timer and the boundary cases are written down rather than hoped for.
import { describe, expect, it } from 'vitest';
import {
  appealDeadline,
  evidenceAcceptance,
  evidenceDeadline,
  isPast,
  mediationDeadline,
  remaining,
} from '../../../src/modules/disputes/domain/windows.js';

const at = (iso: string) => new Date(iso);
const OPENED = at('2026-11-19T09:00:00.000Z');

describe('deadlines', () => {
  it('runs the mediation window from when the case opened, not from now (C13 default 48h)', () => {
    expect(mediationDeadline(OPENED, 48).toISOString()).toBe('2026-11-21T09:00:00.000Z');
  });

  it('runs the evidence window from the same instant, equally for both parties (M3 D2)', () => {
    expect(evidenceDeadline(OPENED, 5).toISOString()).toBe('2026-11-24T09:00:00.000Z');
  });

  it('runs the appeal window from the decision, not from the opening (M3 D5 default 7 days)', () => {
    expect(appealDeadline(at('2026-11-25T12:30:00.000Z'), 7).toISOString()).toBe('2026-12-02T12:30:00.000Z');
  });

  it('refuses a window that is not a positive whole number of units', () => {
    expect(() => mediationDeadline(OPENED, 0)).toThrow();
    expect(() => evidenceDeadline(OPENED, -1)).toThrow();
    expect(() => appealDeadline(OPENED, 1.5)).toThrow();
  });
});

describe('isPast', () => {
  const deadline = at('2026-11-21T09:00:00.000Z');

  it('treats the deadline instant itself as already past (the window is exclusive)', () => {
    expect(isPast(deadline, deadline)).toBe(true);
  });

  it('is not past one millisecond earlier', () => {
    expect(isPast(deadline, at('2026-11-21T08:59:59.999Z'))).toBe(false);
  });
});

describe('remaining', () => {
  const deadline = at('2026-11-21T09:00:00.000Z');

  it('renders Y1’s "31h" strip', () => {
    expect(remaining(deadline, at('2026-11-20T02:00:00.000Z'))).toEqual({
      hours: 31,
      minutes: 0,
      expired: false,
    });
  });

  it('floors to the minute rather than rounding up', () => {
    expect(remaining(deadline, at('2026-11-21T07:30:59.000Z'))).toEqual({
      hours: 1,
      minutes: 29,
      expired: false,
    });
  });

  it('never goes negative once the window has passed', () => {
    expect(remaining(deadline, at('2026-12-01T00:00:00.000Z'))).toEqual({
      hours: 0,
      minutes: 0,
      expired: true,
    });
  });

  it('is expired exactly on the deadline', () => {
    expect(remaining(deadline, deadline).expired).toBe(true);
  });
});

describe('evidenceAcceptance (M3 D2)', () => {
  const deadline = at('2026-11-24T09:00:00.000Z');

  it('accepts evidence inside the window', () => {
    expect(
      evidenceAcceptance({ deadline, now: at('2026-11-24T08:59:59.999Z'), collectionReopened: false }),
    ).toBe('IN_WINDOW');
  });

  it('refuses late evidence when nobody has reopened collection', () => {
    expect(
      evidenceAcceptance({ deadline, now: at('2026-11-24T09:00:00.001Z'), collectionReopened: false }),
    ).toBe('REFUSED');
  });

  it('accepts late evidence once a reviewer has reopened collection, and flags it as late', () => {
    expect(
      evidenceAcceptance({ deadline, now: at('2026-11-30T00:00:00.000Z'), collectionReopened: true }),
    ).toBe('LATE_REOPENED');
  });

  it('does not call evidence late just because collection was reopened while still in window', () => {
    expect(
      evidenceAcceptance({ deadline, now: at('2026-11-20T00:00:00.000Z'), collectionReopened: true }),
    ).toBe('IN_WINDOW');
  });
});
