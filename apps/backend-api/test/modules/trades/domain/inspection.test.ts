// T-065's pure rules: when the inspection window and the grace period may act (AR1, M7 §6), and what
// a request for more inspection time (BEI1) may ask for.
import { describe, expect, it } from 'vitest';
import {
  confirmReleaseBodySchema,
  decideGraceElapsed,
  decideInspectionElapsed,
  validateInspectionExtension,
} from '../../../../src/modules/trades/domain/inspection.js';
import { TRADE_STATUSES, type TradeStatus } from '../../../../src/modules/trades/domain/stateMachine.js';

const calm = { hasActiveHold: false, hasOpenDispute: false };

describe('decideInspectionElapsed (AR1)', () => {
  it('completes an inspection with no hold and no dispute', () => {
    expect(decideInspectionElapsed({ status: 'INSPECTION', ...calm })).toBe('COMPLETE');
  });

  it('waits while a hold is active, and while a dispute exists', () => {
    expect(
      decideInspectionElapsed({ status: 'INSPECTION', hasActiveHold: true, hasOpenDispute: false }),
    ).toBe('WAIT');
    expect(
      decideInspectionElapsed({ status: 'INSPECTION', hasActiveHold: false, hasOpenDispute: true }),
    ).toBe('WAIT');
  });

  it('closes the row as met once the trade is completed or settled, whatever else is going on', () => {
    for (const status of ['COMPLETED', 'SETTLED'] as const) {
      expect(decideInspectionElapsed({ status, hasActiveHold: true, hasOpenDispute: true })).toBe(
        'CLOSE_MET',
      );
    }
  });

  it('closes the row as cancelled for every other state: someone else owns the trade', () => {
    const others = TRADE_STATUSES.filter(
      (s: TradeStatus) => !['INSPECTION', 'COMPLETED', 'SETTLED'].includes(s),
    );
    for (const status of others) {
      expect(decideInspectionElapsed({ status, ...calm }), status).toBe('CLOSE_CANCELLED');
    }
  });
});

describe('decideGraceElapsed (M7 §6)', () => {
  it('converts an unconfirmed delivery with no hold and no dispute', () => {
    expect(decideGraceElapsed({ status: 'UNCONFIRMED_DELIVERY', ...calm })).toBe('CONVERT');
  });

  it('waits on a hold or a dispute', () => {
    expect(
      decideGraceElapsed({ status: 'UNCONFIRMED_DELIVERY', hasActiveHold: true, hasOpenDispute: false }),
    ).toBe('WAIT');
    expect(
      decideGraceElapsed({ status: 'UNCONFIRMED_DELIVERY', hasActiveHold: false, hasOpenDispute: true }),
    ).toBe('WAIT');
  });

  it('closes as met when the trade already moved on through delivery', () => {
    for (const status of ['INSPECTION', 'COMPLETED', 'SETTLED'] as const) {
      expect(decideGraceElapsed({ status, hasActiveHold: true, hasOpenDispute: false })).toBe('CLOSE_MET');
    }
  });

  it('closes as cancelled for anything else, a trade that never reached the grace included', () => {
    expect(decideGraceElapsed({ status: 'DISPUTED', ...calm })).toBe('CLOSE_CANCELLED');
    expect(decideGraceElapsed({ status: 'SHIPPED', ...calm })).toBe('CLOSE_CANCELLED');
  });
});

describe('validateInspectionExtension (BEI1)', () => {
  const now = new Date('2026-11-10T10:00:00Z');
  const dueAt = new Date('2026-11-11T10:00:00Z');
  const base = { now, dueAt, windowHours: 72, extraHours: 24 };

  it('accepts between one hour and one original window', () => {
    expect(validateInspectionExtension(base)).toEqual({ ok: true });
    expect(validateInspectionExtension({ ...base, extraHours: 1 })).toEqual({ ok: true });
    expect(validateInspectionExtension({ ...base, extraHours: 72 })).toEqual({ ok: true });
  });

  it('refuses more than one window, zero, negative and fractional hours', () => {
    expect(validateInspectionExtension({ ...base, extraHours: 73 })).toEqual({ ok: false, code: 'TOO_LONG' });
    for (const extraHours of [0, -5, 1.5]) {
      expect(validateInspectionExtension({ ...base, extraHours })).toEqual({
        ok: false,
        code: 'NOT_POSITIVE',
      });
    }
  });

  it('refuses once the window has already elapsed', () => {
    expect(validateInspectionExtension({ ...base, dueAt: now })).toEqual({
      ok: false,
      code: 'ALREADY_ELAPSED',
    });
  });
});

describe('confirmReleaseBodySchema (Z5)', () => {
  it('needs the explicit acknowledgement, and nothing weaker passes', () => {
    expect(confirmReleaseBodySchema.safeParse({ acknowledged: true }).success).toBe(true);
    for (const body of [{}, { acknowledged: false }, { acknowledged: 'true' }, { acknowledged: 1 }]) {
      expect(confirmReleaseBodySchema.safeParse(body).success).toBe(false);
    }
  });
});
