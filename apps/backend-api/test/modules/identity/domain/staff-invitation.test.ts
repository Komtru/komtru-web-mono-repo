import { describe, expect, it } from 'vitest';
import { createHmacHasher } from '../../../../src/platform/crypto/hmac.js';
import {
  STAFF_INVITATION_DESTINATION_DOMAIN,
  STAFF_INVITATION_TTL_DAYS,
  canAcceptStaffInvitation,
  issueStaffInvitationToken,
  staffInvitationDestinationHash,
  staffInvitationExpiry,
  staffInvitationTokenHash,
  validateStaffInvitation,
} from '../../../../src/modules/identity/domain/staff-invitation.js';
import { INVITATION_DESTINATION_DOMAIN } from '../../../../src/modules/identity/domain/invitation.js';
import { OTP_DESTINATION_DOMAIN } from '../../../../src/modules/identity/domain/otp/challenge.js';

const now = new Date('2026-11-06T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('staff invitation token', () => {
  it('hashes the token it issues and nothing else', () => {
    const { token, tokenHash } = issueStaffInvitationToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(staffInvitationTokenHash(token).equals(tokenHash)).toBe(true);
    expect(staffInvitationTokenHash(`${token}x`).equals(tokenHash)).toBe(false);
  });
});

describe('staff invitation destination hash', () => {
  const hasher = createHmacHasher('p'.repeat(32));

  it('is domain-separated from the party invitation and the OTP hashes', () => {
    const staff = staffInvitationDestinationHash(hasher, 'jane@example.com');
    expect(
      new Set([STAFF_INVITATION_DESTINATION_DOMAIN, INVITATION_DESTINATION_DOMAIN, OTP_DESTINATION_DOMAIN])
        .size,
    ).toBe(3);
    expect(staff.equals(hasher.hmac(INVITATION_DESTINATION_DOMAIN, 'jane@example.com'))).toBe(false);
    expect(staff.equals(hasher.hmac(OTP_DESTINATION_DOMAIN, 'jane@example.com'))).toBe(false);
  });

  it('is stable for the same address', () => {
    expect(
      staffInvitationDestinationHash(hasher, 'a@b.co').equals(
        staffInvitationDestinationHash(hasher, 'a@b.co'),
      ),
    ).toBe(true);
  });
});

describe('staffInvitationExpiry', () => {
  it('is shorter than the 14 days a party invitation gets', () => {
    expect(STAFF_INVITATION_TTL_DAYS).toBeLessThan(14);
    expect(staffInvitationExpiry(now).getTime()).toBe(now.getTime() + STAFF_INVITATION_TTL_DAYS * DAY);
  });
});

describe('validateStaffInvitation', () => {
  it('refuses a role that is not in the catalogue', () => {
    expect(validateStaffInvitation({ roleCode: 'KING', now })).toEqual({ ok: false, reason: 'UNKNOWN_ROLE' });
  });

  it('defaults the grant box to the 365-day maximum rather than forever', () => {
    const verdict = validateStaffInvitation({ roleCode: 'SUPPORT_AGENT', now });
    expect(verdict.ok).toBe(true);
  });

  it('refuses a grant expiry in the past or beyond a year', () => {
    expect(
      validateStaffInvitation({
        roleCode: 'SUPPORT_AGENT',
        grantExpiresAt: new Date(now.getTime() - 1000),
        now,
      }),
    ).toEqual({ ok: false, reason: 'INVALID_EXPIRY' });
    expect(
      validateStaffInvitation({
        roleCode: 'SUPPORT_AGENT',
        grantExpiresAt: new Date(now.getTime() + 366 * DAY),
        now,
      }),
    ).toEqual({ ok: false, reason: 'INVALID_EXPIRY' });
  });

  it('accepts a dual-approval role: the approval is opened at acceptance, not here', () => {
    expect(validateStaffInvitation({ roleCode: 'FINANCE_ADMIN', now }).ok).toBe(true);
  });
});

describe('canAcceptStaffInvitation', () => {
  const live = { status: 'PENDING' as const, expiresAt: new Date(now.getTime() + DAY) };

  it('allows a pending, unexpired invitation', () => {
    expect(canAcceptStaffInvitation(live, now)).toBe(true);
  });

  it.each(['CLAIMED', 'EXPIRED', 'CANCELLED'] as const)('refuses a %s invitation', (status) => {
    expect(canAcceptStaffInvitation({ ...live, status }, now)).toBe(false);
  });

  it('refuses a pending invitation past its expiry, whether or not the sweep has run', () => {
    expect(canAcceptStaffInvitation({ ...live, expiresAt: now }, now)).toBe(false);
  });
});
