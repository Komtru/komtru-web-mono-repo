// The rules of the way in that are not about any one screen: where a person goes once they have a
// session, which `next` is safe to follow, what a new password must be, and the copy every screen
// shares for the failures every call shares.
import type { NextStep } from '@komtru/api-client';
import type { CommonFailure, Factor } from './session-calls';

/** Screen paths, in the reference's own URLs (E1–E4, TOS1–TOS2, AC2–AC3). */
export const ENTRY = {
  welcome: '/',
  signUp: '/signup',
  terms: '/signup/terms',
  verify: '/verify',
  login: '/login',
  forgot: '/reset-password',
  reset: '/reset-password/new',
  setPassword: '/set-password',
  termsUpdated: '/terms-updated',
  fullTerms: '/terms',
} as const;

/**
 * A path on this host and nothing else. `//evil.com` and `/\evil.com` resolve to another origin
 * once a router follows them, so anything that is not plainly a same-site path is dropped. The
 * entry screens themselves are dropped too: sending someone who just signed in back to the login
 * screen is a loop, not a destination.
 */
export function safeNext(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return undefined;
  const path = value.split(/[?#]/, 1)[0] ?? '';
  const entry = [ENTRY.login, ENTRY.signUp, ENTRY.verify, ENTRY.forgot, ENTRY.terms];
  if (entry.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return undefined;
  return value;
}

const withNext = (path: string, next: string | undefined): string =>
  next === undefined ? path : `${path}?next=${encodeURIComponent(next)}`;

/**
 * Where a fresh session goes, from the step the platform says is owed.
 *
 * Terms first, because the platform puts them first: an account that has not accepted the Terms in
 * force has no lawful basis for anything after it. A first password is next on the phone path.
 * Everything else the platform names — a username, a second channel — is first-time onboarding
 * (T-112), which is not built, so it goes where the person was going, and the app's root otherwise.
 */
export function afterSession(nextStep: NextStep | undefined, next: string | undefined): string {
  if (nextStep === 'ACCEPT_TERMS') return withNext(ENTRY.termsUpdated, next);
  if (nextStep === 'SET_PASSWORD') return withNext(ENTRY.setPassword, next);
  return next ?? '/';
}

/**
 * The backend's own floor (`credential/policy.ts`, §S2). The reference's AC3 placeholder says 8;
 * the platform refuses anything under 10, so the screen says 10 rather than promise what fails.
 * The backend still has the last word: it also checks a breach corpus.
 */
export const MIN_PASSWORD_LENGTH = 10;

/** The message to show, or `null` when the pair may be sent. */
export function checkNewPassword(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`;
  }
  if (password !== confirmation) return "The two passwords don't match.";
  return null;
}

export const UNAVAILABLE = "We couldn't reach Komtru. Check your connection and try again.";

export function failureMessage(failure: CommonFailure): string {
  if (failure.kind === 'unavailable') return UNAVAILABLE;
  return failure.wait === undefined
    ? 'Too many attempts. Wait a minute and try again.'
    : `Too many attempts. Try again in ${String(failure.wait)} seconds.`;
}

/** "Resend in 0:24", from seconds left. */
export const countdown = (seconds: number): string =>
  `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;

/** How long the resend link waits after a code goes out. The platform's own budget is the real one. */
export const RESEND_AFTER_SECONDS = 30;

/** A passkey needs the browser's WebAuthn ceremony, which this screen does not run yet. */
export const usableFactors = (factors: readonly Factor[]): Factor[] =>
  factors.filter((factor) => factor.type !== 'PASSKEY');

export function defaultFactor(factors: readonly Factor[]): Factor | undefined {
  const usable = usableFactors(factors);
  return usable.find((factor) => factor.isDefault) ?? usable[0];
}

/** SMS and email factors send a code when asked; an authenticator app and a recovery code do not. */
export const needsSend = (factor: Factor): boolean =>
  factor.type === 'SMS_OTP' || factor.type === 'EMAIL_OTP';

export function factorLabel(factor: Factor): string {
  switch (factor.type) {
    case 'TOTP':
      return 'Authenticator app';
    case 'SMS_OTP':
      return factor.hint === null ? 'Text message' : `Text message to ${factor.hint}`;
    case 'EMAIL_OTP':
      return factor.hint === null ? 'Email' : `Email to ${factor.hint}`;
    case 'RECOVERY_CODE':
      return 'Recovery code';
    case 'PASSKEY':
      return 'Passkey';
  }
}
