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
  /** SP-M16: where a session that ended on its own is explained. */
  sessionExpired: '/session-expired',
} as const;

/** An origin no real request has, to resolve `next` against and see whether it stays there. */
const PROBE = 'https://next.invalid';

/**
 * A path on this host and nothing else, or `undefined`.
 *
 * Decided by parsing, not by looking at the first characters: the URL parser strips tabs and
 * newlines and reads a backslash as a slash, so `/\t/evil.com` passes every prefix test and still
 * resolves to `https://evil.com/` — and `router.replace` follows that off-site. Any control character
 * or backslash is refused outright, and what is left must resolve on the probe origin.
 *
 * The entry screens are dropped too: sending someone who just signed in back to the login screen is
 * a loop, not a destination.
 */
export function safeNext(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  // eslint-disable-next-line no-control-regex
  if (!value.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value, PROBE);
  } catch {
    return undefined;
  }
  if (url.origin !== PROBE || url.pathname.startsWith('//')) return undefined;
  const entry = [ENTRY.login, ENTRY.signUp, ENTRY.verify, ENTRY.forgot, ENTRY.terms, ENTRY.sessionExpired];
  if (entry.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) {
    return undefined;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Where a session that ended on its own sends the person (SP-M16): the explanation, with the screen they were on carried
 * as `next` so one step brings them back. A place that cannot be returned to (an entry screen, or anything `safeNext`
 * refuses) is dropped, and the explanation stands alone.
 */
export function sessionExpiredHref(current: string): string {
  const next = safeNext(current);
  return next === undefined
    ? ENTRY.sessionExpired
    : `${ENTRY.sessionExpired}?next=${encodeURIComponent(next)}`;
}

const withNext = (path: string, next: string | undefined): string =>
  next === undefined ? path : `${path}?next=${encodeURIComponent(next)}`;

/**
 * Where a fresh session goes, from the step the platform says is owed.
 *
 * Terms first, because the platform puts them first: an account that has not accepted the Terms in
 * force has no lawful basis for anything after it. A first password is next on the phone path.
 * Everything else goes where the person was going, and the app's root otherwise. A new sign-up's `next` is the
 * first-time walkthrough (F-013), which the verify screen passes, so terms and the first password still come first.
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

/** "30 seconds", "4 minutes", "about an hour": a wait the way a person would say it. */
export function waitPhrase(seconds: number): string {
  if (seconds < 60) return `${String(seconds)} seconds`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return minutes === 1 ? 'a minute' : `${String(minutes)} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'about an hour' : `about ${String(hours)} hours`;
}

export function failureMessage(failure: CommonFailure): string {
  if (failure.kind === 'unavailable') return UNAVAILABLE;
  return failure.wait === undefined
    ? 'Too many attempts. Wait a minute and try again.'
    : `Too many attempts. Try again in ${waitPhrase(failure.wait)}.`;
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
