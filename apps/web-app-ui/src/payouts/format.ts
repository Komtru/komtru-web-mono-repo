// How the payout screens word what the platform sends. Pure functions, so the wording rules are tested without a
// DOM. No money rule lives here: amounts are the platform's kobo strings, formatted and never summed; the one
// conversion is reading what the seller typed into kobo, which is notation, not arithmetic on a balance.
import { ProblemError } from '@komtru/api-client';
import type { PayoutMode, PayoutStatus } from '@komtru/shared-types';
import type { RowTone } from '../trade/format';
import { problemMessage } from '../trade/format';

/** `******5567` → `•••• 5567`. The platform only ever sends the masked form; only its tail is drawn. */
export const maskedTail = (masked: string): string => `•••• ${masked.replace(/\D/g, '').slice(-4)}`;

/** "GTBank •••• 5567", the way every payout screen names an account. */
export const accountLabel = (account: {
  bankName: string | null;
  bankCode: string;
  accountNumberMasked: string;
}): string => `${account.bankName ?? `Bank ${account.bankCode}`} ${maskedTail(account.accountNumberMasked)}`;

/** The reference's `.bs-logo`: three letters of the bank's name ("GTB"), drawn rather than a logo we do not have. */
export const bankBadge = (bankName: string | null): string => {
  const letters = (bankName ?? '').replace(/[^A-Za-z]/g, '').slice(0, 3);
  return letters === '' ? 'BNK' : letters.toUpperCase();
};

/** A payout's chip. NEEDS_REVIEW is neither paid nor failed: the team is checking the provider's answer. */
export function payoutStatus(status: PayoutStatus): { tone: RowTone; label: string } {
  switch (status) {
    case 'REQUESTED':
    case 'PROCESSING':
      return { tone: 'awaiting', label: 'On its way' };
    case 'SUCCEEDED':
      return { tone: 'protected', label: 'Completed' };
    case 'FAILED':
      return { tone: 'risk', label: 'Didn’t go through' };
    case 'REVERSED':
      return { tone: 'risk', label: 'Returned' };
    case 'NEEDS_REVIEW':
      return { tone: 'verifying', label: 'Being checked' };
  }
}

/** The five ways to be paid, in the platform's order. Weekly is Monday and monthly the 1st (shared-types). */
export const MODE_COPY: Record<PayoutMode, { label: string; detail: string }> = {
  MANUAL: { label: 'When I withdraw', detail: 'Your balance stays here until you withdraw it.' },
  AUTO_IMMEDIATE: {
    label: 'After each sale',
    detail: 'Each sale’s proceeds are sent to your payout account as soon as they are released to you.',
  },
  AUTO_DAILY: {
    label: 'Daily',
    detail: 'Your whole available balance is sent to your payout account every day.',
  },
  AUTO_WEEKLY: {
    label: 'Weekly',
    detail: 'Your whole available balance is sent to your payout account every Monday.',
  },
  AUTO_MONTHLY: {
    label: 'Monthly',
    detail: 'Your whole available balance is sent to your payout account on the 1st of each month.',
  },
};

/**
 * What the seller typed, as kobo: "1,200,000" or "452000.50". Grouping commas and spaces are dropped; anything that
 * is not a plain amount with at most two decimals is `undefined`, never a guess.
 */
export function parseNairaToKobo(text: string): string | undefined {
  const plain = text.replace(/[\s,]/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(plain);
  if (match === null) return undefined;
  const whole = BigInt(match[1] ?? '0');
  const kobo = BigInt((match[2] ?? '').padEnd(2, '0'));
  return (whole * 100n + kobo).toString();
}

/** Kobo as the amount field shows it: grouped naira, with kobo only when there are some. */
export function koboToInput(minor: string): string {
  const value = BigInt(minor);
  const whole = (value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const kobo = value % 100n;
  return kobo === 0n ? whole : `${whole}.${kobo.toString().padStart(2, '0')}`;
}

export type PayoutAction = 'withdraw' | 'schedule' | 'add-account' | 'default-account' | 'remove-account';

const FALLBACK: Record<PayoutAction, string> = {
  withdraw: 'We couldn’t send this withdrawal. Nothing was sent. Try again.',
  schedule: 'We couldn’t change how you’re paid. Try again.',
  'add-account': 'We couldn’t add this account. Try again.',
  'default-account': 'We couldn’t make this your payout account. Try again.',
  'remove-account': 'We couldn’t remove this account. Try again.',
};

/**
 * A refusal in words, from its code and the action that met it, never from the problem's title or detail (the
 * backend's details here are fragments for developers). Codes with nothing payout-specific to say fall through to
 * the app's shared wording.
 */
export function payoutProblem(error: unknown, action: PayoutAction): string {
  const fallback = FALLBACK[action];
  if (!(error instanceof ProblemError)) return fallback;
  switch (error.code) {
    case 'PAYOUT_HELD':
      return 'Payouts on your account are paused. Contact support to find out why.';
    case 'INSUFFICIENT_BALANCE':
      return 'That’s more than your available balance. Withdraw less.';
    case 'PAYMENT_PROVIDER_UNAVAILABLE':
      return 'Bank accounts can’t be checked right now. Try again later.';
    case 'PAYOUT_ACCOUNT_REQUIRED':
      if (action === 'remove-account') {
        return 'Your automatic payouts go to this account. Switch to “When I withdraw”, or make another account your payout account, first.';
      }
      if (action === 'default-account')
        return 'Only an account your bank has verified can be your payout account.';
      if (action === 'schedule') return 'Add a verified bank account before choosing automatic payouts.';
      return 'Add a verified bank account to withdraw.';
    case 'CONFLICT':
      if (action === 'remove-account') {
        return 'A payout to this account is still on its way. Remove it once it has arrived.';
      }
      return fallback;
    case 'VALIDATION_FAILED':
      if (action === 'withdraw') return 'This amount is too small to withdraw.';
      if (action === 'add-account')
        return 'Check the bank, and that the account number is the ten-digit one.';
      return fallback;
    case 'NOT_FOUND':
      return action === 'withdraw'
        ? 'That bank account is no longer on your profile. Choose another.'
        : 'This account is no longer on your profile.';
    default:
      // Rate limits and signed-out sessions read the same everywhere in the app; anything else gets ours.
      return ['RATE_LIMITED', 'UNAUTHENTICATED', 'SESSION_REVOKED', 'TOKEN_EXPIRED'].includes(error.code)
        ? problemMessage(error, fallback)
        : fallback;
  }
}
