// F-045: which proof a step-up can honestly ask for, given what the account holds.
import type { AccountFactor } from '@komtru/api-client';
import { describe, expect, it } from 'vitest';
import { proofFor } from '../src/account/StepUpSheet';
import { factor } from './support/account';

const f = (type: string) => factor(1, { type }) as unknown as AccountFactor;

describe('proofFor', () => {
  it('uses the authenticator first, then a text code', () => {
    expect(proofFor([f('SMS_OTP'), f('TOTP')]).kind).toBe('totp');
    expect(proofFor([f('SMS_OTP')]).kind).toBe('sms');
  });

  it('uses the password only for an account with no factor at all', () => {
    expect(proofFor([]).kind).toBe('password');
    expect(proofFor([], false).kind).toBe('unsupported');
  });

  it('never falls to the password when the account holds a factor this screen cannot use', () => {
    expect(proofFor([f('PASSKEY')]).kind).toBe('unsupported');
    expect(proofFor([f('EMAIL_OTP')]).kind).toBe('unsupported');
    expect(proofFor([f('RECOVERY_CODE')]).kind).toBe('unsupported');
  });
});
