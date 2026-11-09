import { describe, expect, it } from 'vitest';
import {
  decideOverdueDelivery,
  deliveryDeadlineFor,
  validateExtensionRequest,
} from '../../../../src/modules/trades/domain/deadline.js';
import { TRADE_STATUSES } from '../../../../src/modules/trades/domain/stateMachine.js';

const H = 3_600_000;
const DAY = 24 * H;
const now = new Date('2026-11-09T12:00:00.000Z');
const due = new Date(now.getTime() + 6 * H);

describe('delivery deadline', () => {
  it('is the funding time plus the category window in days', () => {
    expect(deliveryDeadlineFor(new Date('2026-11-01T09:00:00.000Z'), 7).toISOString()).toBe(
      '2026-11-08T09:00:00.000Z',
    );
  });
});

describe('extension request (DE1)', () => {
  const base = { now, dueAt: due, extensionCount: 0, windowDays: 7 };

  it('accepts a later date within one window of the original', () => {
    expect(validateExtensionRequest({ ...base, requestedDueAt: new Date(due.getTime() + DAY) })).toEqual({
      ok: true,
    });
    expect(validateExtensionRequest({ ...base, requestedDueAt: new Date(due.getTime() + 7 * DAY) })).toEqual({
      ok: true,
    });
  });

  it('refuses a date that is not later, or is too far out', () => {
    expect(validateExtensionRequest({ ...base, requestedDueAt: due })).toEqual({
      ok: false,
      code: 'NOT_LATER',
    });
    expect(validateExtensionRequest({ ...base, requestedDueAt: new Date(due.getTime() - H) })).toEqual({
      ok: false,
      code: 'NOT_LATER',
    });
    expect(
      validateExtensionRequest({ ...base, requestedDueAt: new Date(due.getTime() + 7 * DAY + 1) }),
    ).toEqual({ ok: false, code: 'TOO_LONG' });
  });

  it('refuses once the deadline has passed, and a second extension', () => {
    expect(
      validateExtensionRequest({
        ...base,
        dueAt: new Date(now.getTime() - 1),
        requestedDueAt: new Date(now.getTime() + DAY),
      }),
    ).toEqual({ ok: false, code: 'ALREADY_OVERDUE' });
    expect(
      validateExtensionRequest({ ...base, extensionCount: 1, requestedDueAt: new Date(due.getTime() + DAY) }),
    ).toEqual({ ok: false, code: 'ALREADY_EXTENDED' });
  });
});

describe('overdue decision (DE3, DE4)', () => {
  const clear = { hasActiveHold: false };

  it('requests a refund for a funded trade with nothing shipped and no extension', () => {
    expect(decideOverdueDelivery({ status: 'FUNDED', ...clear })).toBe('REQUEST_REFUND');
  });

  it('only elapses a shipped trade: there is no refund edge after dispatch', () => {
    expect(decideOverdueDelivery({ status: 'SHIPPED', ...clear })).toBe('ELAPSE_NO_REFUND');
  });

  it('waits on a hold, in FUNDED and SHIPPED alike', () => {
    for (const status of ['FUNDED', 'SHIPPED'] as const) {
      expect(decideOverdueDelivery({ status, hasActiveHold: true })).toBe('WAIT');
    }
  });

  it('closes the deadline as met once delivery has been signalled, ignoring holds', () => {
    for (const status of ['UNCONFIRMED_DELIVERY', 'INSPECTION', 'COMPLETED', 'SETTLED'] as const) {
      expect(decideOverdueDelivery({ status, hasActiveHold: true })).toBe('CLOSE_MET');
    }
  });

  it('cancels the deadline everywhere else', () => {
    const rest = TRADE_STATUSES.filter(
      (s) => !['FUNDED', 'SHIPPED', 'UNCONFIRMED_DELIVERY', 'INSPECTION', 'COMPLETED', 'SETTLED'].includes(s),
    );
    for (const status of rest) {
      expect(decideOverdueDelivery({ status, ...clear }), status).toBe('CLOSE_CANCELLED');
    }
  });
});
