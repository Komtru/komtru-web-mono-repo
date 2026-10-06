import { describe, expect, it } from 'vitest';
import { nextStep, type OnboardingState } from '../../../../src/modules/identity/domain/registration.js';

/** A phone-first signup the moment the account row exists (screen E2). */
const base: OnboardingState = {
  emailVerified: false,
  phoneVerified: false,
  hasEmail: false,
  hasPhone: true,
  hasPassword: false,
  hasUsername: false,
  termsUpToDate: true,
};

describe('the onboarding step a client should show next (M1 §9.3)', () => {
  it.each([
    [{ ...base }, 'VERIFY_PHONE'],
    [{ ...base, hasPhone: false, hasEmail: true }, 'VERIFY_EMAIL'],
    // §9.3's phone path: the password comes AFTER the channel is proven.
    [{ ...base, phoneVerified: true }, 'SET_PASSWORD'],
    [{ ...base, phoneVerified: true, hasPassword: true }, 'CHOOSE_USERNAME'],
    [{ ...base, phoneVerified: true, hasPassword: true, hasUsername: true }, 'ADD_EMAIL'],
    [
      {
        ...base,
        hasPhone: false,
        hasEmail: true,
        emailVerified: true,
        hasPassword: true,
        hasUsername: true,
      },
      'ADD_PHONE',
    ],
    [
      {
        ...base,
        hasEmail: true,
        emailVerified: true,
        phoneVerified: true,
        hasPassword: true,
        hasUsername: true,
      },
      'DONE',
    ],
  ])('nextStep(%o) is %s', (state, expected) => {
    expect(nextStep(state)).toBe(expected);
  });

  it('puts stale terms ahead of everything, because TOS2 blocks the app', () => {
    expect(nextStep({ ...base, termsUpToDate: false })).toBe('ACCEPT_TERMS');
    expect(
      nextStep({
        ...base,
        hasEmail: true,
        emailVerified: true,
        phoneVerified: true,
        hasPassword: true,
        hasUsername: true,
        termsUpToDate: false,
      }),
    ).toBe('ACCEPT_TERMS');
  });

  it('asks for the second channel to be ADDED, not verified, when there is no row for it', () => {
    // §9.3: email users add a phone, phone users add an email. A channel with a row but no
    // verification goes back to the verify step instead.
    expect(
      nextStep({ ...base, phoneVerified: true, hasPassword: true, hasUsername: true, hasEmail: true }),
    ).toBe('VERIFY_EMAIL');
  });

  it('does not ask an email-path user to set a password they already have', () => {
    expect(
      nextStep({
        ...base,
        hasPhone: false,
        hasEmail: true,
        emailVerified: true,
        hasPassword: true,
      }),
    ).toBe('CHOOSE_USERNAME');
  });
});
