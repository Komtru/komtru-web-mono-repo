// M20 §5's thresholds. The sync job is the only writer of storage_accounts.status, and this is the
// whole of its decision.
import { describe, expect, it } from 'vitest';
import { statusForCredits } from '../../../../src/modules/files/domain/quota.js';

const thresholds = { nearPct: 85, disabledPct: 97 };

describe('statusForCredits', () => {
  it('leaves a healthy account ACTIVE', () => {
    expect(statusForCredits(0, thresholds)).toBe('ACTIVE');
    expect(statusForCredits(84.99, thresholds)).toBe('ACTIVE');
  });

  it('deprioritises at the near threshold', () => {
    expect(statusForCredits(85, thresholds)).toBe('NEAR_QUOTA');
    expect(statusForCredits(96.99, thresholds)).toBe('NEAR_QUOTA');
  });

  it('takes an account out of rotation at the disabled threshold', () => {
    expect(statusForCredits(97, thresholds)).toBe('DISABLED');
    expect(statusForCredits(100, thresholds)).toBe('DISABLED');
  });

  it('recovers on its own when usage falls back', () => {
    // Cloudinary's credit meter resets monthly, so an account that tripped a threshold in the last
    // week of the month must come back by itself: an operator re-enabling five accounts every month
    // is a runbook nobody follows.
    expect(statusForCredits(12, thresholds)).toBe('ACTIVE');
  });

  it('honours thresholds an operator tuned', () => {
    expect(statusForCredits(60, { nearPct: 50, disabledPct: 70 })).toBe('NEAR_QUOTA');
  });
});
