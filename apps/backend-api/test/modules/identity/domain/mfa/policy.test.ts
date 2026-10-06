// M1 D2 C4 and §S13, as one function with no database in it.
import { describe, expect, it } from 'vitest';
import {
  factorAmr,
  mfaEnrolmentHash,
  mfaRequirement,
  mfaSubjectHash,
  type MfaRequirementInput,
} from '../../../../../src/modules/identity/domain/mfa/policy.js';
import { createHmacHasher } from '../../../../../src/platform/crypto/hmac.js';

const base: MfaRequirementInput = {
  scope: 'CONSUMER',
  activeFactorTypes: [],
  holdsAdminRole: false,
  staffRequireMfa: true,
};

describe('mfaRequirement — consumer scope', () => {
  it('asks for nothing when the account has no factor', () => {
    expect(mfaRequirement(base)).toEqual({ required: false, enrolmentRequired: false });
  });

  it('asks for a factor when the account has one', () => {
    expect(mfaRequirement({ ...base, activeFactorTypes: ['TOTP'] })).toEqual({
      required: true,
      enrolmentRequired: false,
    });
  });

  /**
   * Ten printed codes are a way back in when the phone is lost, not a second factor: an account
   * holding only these has nothing to present at a login that it did not already hand the user on a
   * screen. Treating them as MFA would also mean a user who enrols TOTP and then removes it is
   * still "two-factor" forever.
   */
  it('does not count recovery codes as a factor', () => {
    expect(mfaRequirement({ ...base, activeFactorTypes: ['RECOVERY_CODE'] }).required).toBe(false);
    expect(mfaRequirement({ ...base, activeFactorTypes: ['RECOVERY_CODE', 'TOTP'] }).required).toBe(true);
  });

  /**
   * C4's forced setup is about STAFF sessions (§S13). Applying it to an admin's consumer session
   * would lock the bootstrap admin out of the consumer app with no route to enrol, since enrolment
   * is itself a `/me` route — and a consumer session carrying no factor is already bounded by the
   * §S7 step-up gate on everything that matters.
   */
  it('does not force an admin into setup on the consumer app', () => {
    expect(mfaRequirement({ ...base, holdsAdminRole: true })).toEqual({
      required: false,
      enrolmentRequired: false,
    });
  });
});

describe('mfaRequirement — staff scope (D2 C4, §S13)', () => {
  const staff: MfaRequirementInput = { ...base, scope: 'STAFF', holdsAdminRole: true };

  it('requires MFA and names the forced-setup state when there is no factor', () => {
    expect(mfaRequirement(staff)).toEqual({ required: true, enrolmentRequired: true });
  });

  it('requires MFA and is satisfied when there is one', () => {
    expect(mfaRequirement({ ...staff, activeFactorTypes: ['PASSKEY'] })).toEqual({
      required: true,
      enrolmentRequired: false,
    });
  });

  it('is relaxed by the operator switch, which exists for a local sandbox', () => {
    expect(mfaRequirement({ ...staff, staffRequireMfa: false })).toEqual({
      required: false,
      enrolmentRequired: false,
    });
  });

  /** Recovery codes do not satisfy C4 either: forced setup ends when a real factor exists. */
  it('still forces setup for an admin holding only recovery codes', () => {
    expect(mfaRequirement({ ...staff, activeFactorTypes: ['RECOVERY_CODE'] })).toEqual({
      required: true,
      enrolmentRequired: true,
    });
  });
});

describe('mfaRequirement — logistics scope', () => {
  it('follows the consumer rule: a factor if you have one, nothing if you do not', () => {
    expect(mfaRequirement({ ...base, scope: 'LOGISTICS' }).required).toBe(false);
    expect(mfaRequirement({ ...base, scope: 'LOGISTICS', activeFactorTypes: ['TOTP'] }).required).toBe(true);
  });
});

describe('factorAmr', () => {
  it('maps each factor onto the RFC 8176 value the session records', () => {
    expect(factorAmr('TOTP')).toBe('otp');
    expect(factorAmr('SMS_OTP')).toBe('sms');
    expect(factorAmr('EMAIL_OTP')).toBe('otp');
    expect(factorAmr('PASSKEY')).toBe('passkey');
    expect(factorAmr('RECOVERY_CODE')).toBe('recovery');
  });
});

describe('the two subject hashes', () => {
  const hasher = createHmacHasher('pepper-for-tests-0123456789abcdef');
  const userId = '11111111-1111-4111-8111-111111111111';

  /**
   * From review. Both the login `mfaToken` and the enrolment ceremony are `otp_challenges` rows of
   * purpose MFA_CHALLENGE scoped to a user, and `findLiveChallengeFor` returns the NEWEST row for a
   * `(destination_hash, purpose, user_id)`. Sharing one hash made them one family, so signing in on
   * a second device superseded a half-finished enrolment — killing the QR code the user had just
   * scanned — and finishing any enrolment consumed a live sign-in challenge.
   */
  it('keeps a sign-in challenge and an enrolment ceremony in different families', () => {
    expect(mfaEnrolmentHash(hasher, userId)).not.toEqual(mfaSubjectHash(hasher, userId));
  });

  it('gives each user their own, so one account cannot supersede another’s', () => {
    const other = '22222222-2222-4222-8222-222222222222';
    expect(mfaSubjectHash(hasher, userId)).not.toEqual(mfaSubjectHash(hasher, other));
    expect(mfaEnrolmentHash(hasher, userId)).not.toEqual(mfaEnrolmentHash(hasher, other));
  });
});
