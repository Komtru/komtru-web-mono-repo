// How the account screens word what the platform says. Pure functions, so the wording is tested without a DOM.
// A screen branches on the problem's `code` and never on its title or detail, which the platform may reword.
import { NetworkError, ProblemError } from '@komtru/api-client';
import { problemMessage } from '../trade/format';

export type AccountAction =
  | 'close'
  | 'erase'
  | 'step-up'
  | 'enable-factor'
  | 'remove-factor'
  | 'new-codes'
  | 'sign-out-device'
  | 'export'
  | 'verify-id'
  | 'phone'
  | 'recovery';

const FALLBACK: Record<AccountAction, string> = {
  close: 'We couldn’t close your account. Try again in a moment.',
  erase: 'We couldn’t send that request. Try again in a moment.',
  'step-up': 'We couldn’t confirm it’s you. Try again.',
  'enable-factor': 'We couldn’t turn on two-step sign-in. Try again.',
  'remove-factor': 'We couldn’t remove that. Try again.',
  'new-codes': 'We couldn’t make new codes. Try again.',
  'sign-out-device': 'We couldn’t sign that device out. Try again.',
  export: 'We couldn’t send that request. Try again in a moment.',
  'verify-id': 'We couldn’t send that for checking. Try again.',
  phone: 'We couldn’t change your number. Try again.',
  recovery: 'We couldn’t send your request. Try again in a moment.',
};

/** Whether this problem is the platform refusing to close an account that still has a trade in progress. */
export const isActiveTradesRefusal = (error: unknown): boolean =>
  error instanceof ProblemError &&
  error.code === 'CONFLICT' &&
  (error.problem as { reason?: unknown }).reason === 'ACTIVE_TRADES';

/** The sentence for a failed account action. Wrong codes and passwords are the person's to fix, so they say so. */
export function accountProblem(error: unknown, action: AccountAction): string {
  if (error instanceof ProblemError) {
    switch (error.code) {
      case 'INVALID_CREDENTIALS':
        return 'That password isn’t right.';
      case 'OTP_INVALID': {
        const left = (error.problem as { attemptsRemaining?: unknown }).attemptsRemaining;
        return typeof left === 'number' && left > 0
          ? `That code isn’t right. ${String(left)} ${left === 1 ? 'try' : 'tries'} left.`
          : 'That code isn’t right, or it has expired. Ask for a new one.';
      }
      case 'RATE_LIMITED':
        // The recovery request is three an hour; the other phone steps are tighter than a minute.
        if (action === 'recovery') return 'You’ve asked too many times. Try again in an hour.';
        break;
      case 'VALIDATION_FAILED':
        if (action === 'phone') return 'That number can’t be used. Check it and try again.';
        break;
      case 'STEP_UP_REQUIRED':
        return 'Confirm it’s you first, then try again.';
      case 'CONTACT_VERIFICATION_REQUIRED':
        return 'Confirm your email and phone number first, then send this again.';
      case 'CONFLICT':
        if (isActiveTradesRefusal(error)) {
          return 'You still have a Trade in progress. Finish or cancel it first.';
        }
        // The trade screens' CONFLICT wording ("the terms changed") is about trades; here the platform's own sentence is
        // the answer (a number already in use, a factor already set up).
        return error.problem.detail ?? FALLBACK[action];
    }
  }
  if (error instanceof NetworkError) return 'We couldn’t reach Komtru. Check your connection and try again.';
  return problemMessage(error, FALLBACK[action]);
}

/** "Changed 2 months ago", "3 days ago", "active now": a moment, the way a person says it. */
export function ago(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60_000));
  if (minutes < 5) return 'active now';
  if (minutes < 60) return `${String(minutes)} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${String(days)} ${days === 1 ? 'day' : 'days'} ago`;
  const months = Math.round(days / 30);
  return `${String(months)} months ago`;
}

/** `JBSWY3DPEHPK3PXP` → `JBSW Y3DP EHPK 3PXP`: the key as it is read aloud or typed from a screen. */
export const groupedKey = (secret: string): string =>
  secret
    .replace(/\s/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim();

/** The platform's `ABCD-EFGH` backup codes, two to a row as TF2 draws them. */
export function codeRows(codes: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < codes.length; i += 2) rows.push(codes.slice(i, i + 2));
  return rows;
}
