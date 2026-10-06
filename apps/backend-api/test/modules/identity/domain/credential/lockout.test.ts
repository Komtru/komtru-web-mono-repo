import { describe, expect, it } from 'vitest';
import {
  LOCKOUT_CAP_MINUTES,
  LOCKOUT_THRESHOLD,
  lockedUntil,
  lockoutMinutes,
} from '../../../../../src/modules/identity/domain/credential/lockout.js';

describe('account lockout (S5)', () => {
  it.each([
    [0, 0],
    [9, 0],
    [10, 15],
    [11, 30],
    [12, 60],
    [13, 120],
  ])('%i failures locks for %i minutes', (failures, minutes) => {
    expect(lockoutMinutes(failures)).toBe(minutes);
  });

  it('starts at the threshold M1 names', () => {
    expect(LOCKOUT_THRESHOLD).toBe(10);
  });

  it('caps at a day, because a permanent lockout is a denial of service against our own users', () => {
    expect(lockoutMinutes(100)).toBe(LOCKOUT_CAP_MINUTES);
    expect(Number.isFinite(lockoutMinutes(1_000_000))).toBe(true);
    expect(lockoutMinutes(1_000_000)).toBe(LOCKOUT_CAP_MINUTES);
  });

  it('lockedUntil is null below the threshold and a future date above it', () => {
    const now = new Date('2026-10-06T00:00:00Z');
    expect(lockedUntil(9, now)).toBeNull();
    expect(lockedUntil(10, now)).toEqual(new Date('2026-10-06T00:15:00Z'));
    expect(lockedUntil(11, now)).toEqual(new Date('2026-10-06T00:30:00Z'));
  });

  it('treats a negative or fractional count as no lock rather than throwing', () => {
    expect(lockoutMinutes(-1)).toBe(0);
    expect(lockoutMinutes(10.5)).toBe(15);
  });
});
