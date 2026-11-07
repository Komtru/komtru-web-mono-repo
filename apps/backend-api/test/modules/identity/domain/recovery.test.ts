import { describe, expect, it } from 'vitest';
import {
  RECOVERY_HUMAN_REVIEW_THRESHOLD,
  recoveryRiskScore,
  recoveryNeedsHuman,
} from '../../../../src/modules/identity/domain/recovery.js';
import { RECOVERY_METHODS } from '../../../../src/modules/identity/domain/events.js';

describe('account recovery risk (M1 section 11)', () => {
  it('scores a harder-to-prove loss higher, whatever else is equal', () => {
    const base = { hasEvidence: true, accountStatus: 'ACTIVE', holdsStaffRole: false } as const;
    const score = (method: (typeof RECOVERY_METHODS)[number]) => recoveryRiskScore({ method, ...base });
    expect(score('LOST_PASSWORD')).toBeLessThan(score('MFA_LOCKOUT'));
    expect(score('MFA_LOCKOUT')).toBeLessThan(score('LOST_PHONE'));
    expect(score('LOST_PHONE')).toBeLessThan(score('LOST_ALL'));
  });

  it('adds for no evidence, a locked account and a staff account, and never leaves 0..100', () => {
    const quiet = recoveryRiskScore({
      method: 'LOST_PASSWORD',
      hasEvidence: true,
      accountStatus: 'ACTIVE',
      holdsStaffRole: false,
    });
    expect(
      recoveryRiskScore({
        method: 'LOST_PASSWORD',
        hasEvidence: false,
        accountStatus: 'ACTIVE',
        holdsStaffRole: false,
      }),
    ).toBeGreaterThan(quiet);
    expect(
      recoveryRiskScore({
        method: 'LOST_PASSWORD',
        hasEvidence: true,
        accountStatus: 'LOCKED',
        holdsStaffRole: false,
      }),
    ).toBeGreaterThan(quiet);
    expect(
      recoveryRiskScore({
        method: 'LOST_PASSWORD',
        hasEvidence: true,
        accountStatus: 'ACTIVE',
        holdsStaffRole: true,
      }),
    ).toBeGreaterThan(quiet);
    const worst = recoveryRiskScore({
      method: 'LOST_ALL',
      hasEvidence: false,
      accountStatus: 'LOCKED',
      holdsStaffRole: true,
    });
    expect(worst).toBeLessThanOrEqual(100);
    expect(quiet).toBeGreaterThanOrEqual(0);
  });

  it('puts a human in the loop for every scored request at the default threshold', () => {
    expect(RECOVERY_HUMAN_REVIEW_THRESHOLD).toBe(0);
    for (const method of RECOVERY_METHODS) {
      const score = recoveryRiskScore({
        method,
        hasEvidence: true,
        accountStatus: 'ACTIVE',
        holdsStaffRole: false,
      });
      expect(recoveryNeedsHuman(score)).toBe(true);
    }
    expect(recoveryNeedsHuman(5, 10)).toBe(false);
    expect(recoveryNeedsHuman(11, 10)).toBe(true);
  });
});
