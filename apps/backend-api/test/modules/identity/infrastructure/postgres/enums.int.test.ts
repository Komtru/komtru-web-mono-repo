// M1 §5.1's enumerations, with the two deviations the ticket mandates. Skipped unless
// KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../../support/db-urls.js';
import { useTestDatabase } from '../../../../support/db.js';
import { enumLabels } from './support.js';

describe.runIf(infraEnabled)('identity enumerations', () => {
  const t = useTestDatabase();

  it.each([
    [
      'user_status',
      ['PENDING_VERIFICATION', 'ACTIVE', 'RESTRICTED', 'SUSPENDED', 'LOCKED', 'CLOSED', 'ANONYMISED'],
    ],
    [
      'verification_level',
      ['UNVERIFIED', 'CONTACT_VERIFIED', 'IDENTITY_VERIFIED', 'BUSINESS_VERIFIED', 'ENHANCED'],
    ],
    ['capability_type', ['MERCHANT', 'MERCHANT_MEMBER', 'STAFF']],
    ['capability_status', ['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED']],
    ['social_provider', ['GOOGLE', 'APPLE', 'FACEBOOK']],
    ['mfa_factor_type', ['TOTP', 'SMS_OTP', 'EMAIL_OTP', 'PASSKEY', 'RECOVERY_CODE']],
    ['mfa_factor_status', ['PENDING', 'ACTIVE', 'REVOKED']],
    [
      'otp_purpose',
      [
        'REGISTRATION',
        'LOGIN',
        'PHONE_VERIFICATION',
        'EMAIL_VERIFICATION',
        'PASSWORD_RESET',
        'MFA_CHALLENGE',
        'SENSITIVE_ACTION',
        'ACCOUNT_RECOVERY',
      ],
    ],
    ['otp_channel', ['SMS', 'EMAIL', 'WHATSAPP', 'VOICE']],
    ['session_scope', ['CONSUMER', 'STAFF', 'LOGISTICS']],
    ['device_status', ['ACTIVE', 'TRUSTED', 'BLOCKED', 'RETIRED']],
    ['invitation_status', ['PENDING', 'CLAIMED', 'EXPIRED', 'CANCELLED']],
  ])('creates identity.%s with the spec labels in order', async (name, labels) => {
    expect(await enumLabels(t.owner(), name)).toEqual(labels);
  });

  // Design §6.3: anyone may sell, so there is nothing to opt into; MERCHANT is the certified,
  // sell-only capability that replaces it.
  it('has no SELLER capability', async () => {
    expect(await enumLabels(t.owner(), 'capability_type')).not.toContain('SELLER');
  });

  // Design C2: logistics staff are a capability on the same users row, separated by session scope.
  it('carries a LOGISTICS session scope', async () => {
    expect(await enumLabels(t.owner(), 'session_scope')).toContain('LOGISTICS');
  });
});
