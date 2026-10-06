// What `GET /me/mfa/factors` may say about a factor, which is the half of mfa.service.ts that
// needs no database — and the half where a mistake leaks a secret rather than breaking a flow.
import { describe, expect, it } from 'vitest';
import { factorView, type FactorRow } from '../../../../src/modules/identity/services/mfa.service.js';

const row = (overrides: Partial<FactorRow> = {}): FactorRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  factorType: 'TOTP',
  status: 'ACTIVE',
  label: 'Authenticator app',
  isDefault: true,
  phoneId: null,
  secretEnc: Buffer.from('v1:deadbeef:deadbeef:deadbeef', 'utf8'),
  verifiedAt: new Date('2026-10-01T00:00:00.000Z'),
  lastUsedAt: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  ...overrides,
});

describe('factorView', () => {
  it('never carries the sealed secret, whatever the factor is', () => {
    for (const factorType of ['TOTP', 'SMS_OTP', 'PASSKEY', 'RECOVERY_CODE'] as const) {
      const view = factorView(row({ factorType }), { maskedDestination: null, remaining: null });
      expect(Object.keys(view)).not.toContain('secretEnc');
      expect(JSON.stringify(view)).not.toContain('deadbeef');
    }
  });

  it('shows an SMS factor as a masked number and nothing else about it', () => {
    const view = factorView(row({ factorType: 'SMS_OTP', label: null }), {
      maskedDestination: '+234802•••5567',
      remaining: null,
    });
    expect(view.maskedDestination).toBe('+234802•••5567');
    expect(view.remaining).toBeUndefined();
  });

  it('shows recovery codes as a count, because there is nothing else to show', () => {
    const view = factorView(row({ factorType: 'RECOVERY_CODE', label: null }), {
      maskedDestination: null,
      remaining: 7,
    });
    expect(view.remaining).toBe(7);
    expect(view.maskedDestination).toBeUndefined();
  });

  /** The list is what screen TF1 renders back to the user; an unlabelled factor still needs a name. */
  it('falls back to a label for the factor type when the user never set one', () => {
    expect(factorView(row({ label: null }), { maskedDestination: null, remaining: null }).label).toBe(
      'Authenticator app',
    );
    expect(
      factorView(row({ factorType: 'PASSKEY', label: null }), { maskedDestination: null, remaining: null })
        .label,
    ).toBe('Passkey');
    expect(
      factorView(row({ factorType: 'RECOVERY_CODE', label: null }), {
        maskedDestination: null,
        remaining: 3,
      }).label,
    ).toBe('Backup codes');
  });
});
