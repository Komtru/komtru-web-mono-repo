// T-068's inspection reminder rule, pure: when the one reminder per window may be sent.
import { describe, expect, it } from 'vitest';
import {
  REMINDER_LEAD_CAP_HOURS,
  decideInspectionReminder,
  reminderLeadHours,
} from '../../../../src/modules/trades/domain/inspection.js';

const H = 3_600_000;
const now = new Date('2026-11-09T10:00:00.000Z');
const due = (hours: number) => new Date(now.getTime() + hours * H);
const facts = (overrides: Partial<Parameters<typeof decideInspectionReminder>[0]> = {}) => ({
  status: 'INSPECTION' as const,
  hasActiveHold: false,
  hasOpenDispute: false,
  alreadyReminded: false,
  dueAt: due(10),
  now,
  windowHours: 72,
  ...overrides,
});

describe('reminderLeadHours', () => {
  it('is a day for a normal window and half of a short one', () => {
    expect(REMINDER_LEAD_CAP_HOURS).toBe(24);
    expect(reminderLeadHours(72)).toBe(24);
    expect(reminderLeadHours(48)).toBe(24);
    expect(reminderLeadHours(24)).toBe(12);
    expect(reminderLeadHours(10)).toBe(5);
    expect(reminderLeadHours(1)).toBe(1);
  });
});

describe('decideInspectionReminder', () => {
  it('reminds a buyer whose window closes within the lead', () => {
    expect(decideInspectionReminder(facts({ dueAt: due(24) }))).toBe('REMIND');
    expect(decideInspectionReminder(facts({ dueAt: due(1) }))).toBe('REMIND');
  });

  it('is not yet time before the lead, and never once the deadline has passed', () => {
    expect(decideInspectionReminder(facts({ dueAt: due(24.01) }))).toBe('NOT_YET');
    expect(decideInspectionReminder(facts({ dueAt: now }))).toBe('NOT_YET');
    expect(decideInspectionReminder(facts({ dueAt: due(-1) }))).toBe('NOT_YET');
  });

  it('uses half of a short window as the lead', () => {
    expect(decideInspectionReminder(facts({ windowHours: 10, dueAt: due(6) }))).toBe('NOT_YET');
    expect(decideInspectionReminder(facts({ windowHours: 10, dueAt: due(4) }))).toBe('REMIND');
  });

  it('sends one reminder per deadline', () => {
    expect(decideInspectionReminder(facts({ alreadyReminded: true }))).toBe('SKIP');
  });

  it('does not remind about a window the buyer cannot act in', () => {
    expect(decideInspectionReminder(facts({ hasActiveHold: true }))).toBe('SKIP');
    expect(decideInspectionReminder(facts({ hasOpenDispute: true }))).toBe('SKIP');
  });

  it('only ever reminds a trade that is in inspection', () => {
    for (const status of [
      'SHIPPED',
      'UNCONFIRMED_DELIVERY',
      'COMPLETED',
      'SETTLED',
      'DISPUTED',
      'FUNDED',
    ] as const) {
      expect(decideInspectionReminder(facts({ status })), status).toBe('SKIP');
    }
  });
});
