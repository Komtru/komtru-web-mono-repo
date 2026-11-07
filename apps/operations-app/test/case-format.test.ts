import type { CaseView } from '@komtru/api-client';
import { describe, expect, it } from 'vitest';
import {
  agoLabel,
  areaOf,
  clockLabel,
  clockTone,
  ownerLabel,
  priorityLabel,
  stateLabel,
  typeLabel,
} from '../src/cases/format';

const sla = (over: Partial<CaseView['sla']> = {}): CaseView['sla'] => ({
  status: 'ON_TRACK',
  dueAt: '2026-11-07T10:00:00.000Z',
  remainingMinutes: 600,
  hours: 24,
  startedAt: '2026-11-06T10:00:00.000Z',
  ...over,
});

describe('areaOf', () => {
  it('groups case types into the areas the reference names', () => {
    expect(areaOf('TRADE_PROPOSAL')).toBe('Proposals');
    expect(areaOf('DISPUTE')).toBe('Cases');
    expect(areaOf('FRAUD')).toBe('Risk');
    expect(areaOf('PAYMENT_EXCEPTION')).toBe('Money');
    expect(areaOf('CUSTODY')).toBe('Custody');
    for (const type of ['KYB', 'IDENTITY', 'MERCHANT_APPLICATION', 'PARK_HUB_APPLICATION'] as const) {
      expect(areaOf(type)).toBe('People');
    }
  });
});

describe('clockLabel', () => {
  it('writes minutes, hours and days the way the reference does', () => {
    expect(clockLabel(sla({ remainingMinutes: 52 }))).toBe('52m');
    expect(clockLabel(sla({ remainingMinutes: 100 }))).toBe('1h 40m');
    expect(clockLabel(sla({ remainingMinutes: 120 }))).toBe('2h');
    expect(clockLabel(sla({ remainingMinutes: 68 * 60 }))).toBe('2d 20h');
    expect(clockLabel(sla({ remainingMinutes: 24 * 60 }))).toBe('1d');
  });

  it('says Overdue for a breached clock, however far past', () => {
    expect(clockLabel(sla({ status: 'BREACHED', remainingMinutes: -90 }))).toBe('Overdue');
  });

  it('shows a dash when the clock is stopped', () => {
    expect(clockLabel(sla({ status: 'STOPPED', remainingMinutes: null }))).toBe('Stopped');
  });
});

describe('clockTone', () => {
  it('flags at-risk and breached clocks and leaves the rest plain', () => {
    expect(clockTone(sla({ status: 'AT_RISK' }))).toBe('awaiting');
    expect(clockTone(sla({ status: 'BREACHED' }))).toBe('risk');
    expect(clockTone(sla())).toBeUndefined();
  });
});

describe('labels', () => {
  it('turn codes into words', () => {
    expect(typeLabel('PARK_HUB_APPLICATION')).toBe('Park hub application');
    expect(stateLabel('AWAITING_EVIDENCE')).toBe('Awaiting evidence');
    expect(priorityLabel('URGENT')).toBe('Urgent');
  });

  it('names the owner as You, Unassigned or a short id', () => {
    expect(ownerLabel(null, 'u1')).toBe('Unassigned');
    expect(ownerLabel('u1', 'u1')).toBe('You');
    expect(ownerLabel('0190b0a0-0000-7000-8000-000000000042', 'u1')).toBe('Staff 000000000042');
  });
});

describe('agoLabel', () => {
  const now = new Date('2026-11-07T12:00:00.000Z');
  it("says how long ago in the clock's own units", () => {
    expect(agoLabel('2026-11-07T11:52:00.000Z', now)).toBe('8m');
    expect(agoLabel('2026-11-07T11:00:00.000Z', now)).toBe('1h');
    expect(agoLabel('2026-11-05T09:00:00.000Z', now)).toBe('2d');
    expect(agoLabel('2026-11-07T12:00:30.000Z', now)).toBe('0m');
  });
});
