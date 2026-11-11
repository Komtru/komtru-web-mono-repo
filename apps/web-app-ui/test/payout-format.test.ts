import { ProblemError } from '@komtru/api-client';
import { describe, expect, it } from 'vitest';
import {
  MODE_COPY,
  isDecidedRefusal,
  accountLabel,
  bankBadge,
  koboToInput,
  maskedTail,
  parseNairaToKobo,
  payoutProblem,
  payoutStatus,
} from '../src/payouts/format';

const problem = (code: string, status = 409, detail?: string) =>
  new ProblemError(
    {
      type: 'about:blank',
      title: 'Title copy',
      status,
      code,
      ...(detail === undefined ? {} : { detail }),
    },
    { status, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
    false,
  );

describe('payout wording', () => {
  it('shows only the last four digits the platform sent', () => {
    expect(maskedTail('******5567')).toBe('•••• 5567');
    expect(accountLabel({ bankName: 'GTBank', bankCode: '058', accountNumberMasked: '******5567' })).toBe(
      'GTBank •••• 5567',
    );
    expect(accountLabel({ bankName: null, bankCode: '058', accountNumberMasked: '******5567' })).toBe(
      'Bank 058 •••• 5567',
    );
  });

  it('draws a short badge from the bank’s name', () => {
    expect(bankBadge('GTBank')).toBe('GTB');
    expect(bankBadge('Access Bank')).toBe('ACC');
    expect(bankBadge(null)).toBe('BNK');
  });

  it('words every payout status, and never calls one in review failed or paid', () => {
    expect(payoutStatus('REQUESTED')).toEqual({ tone: 'awaiting', label: 'On its way' });
    expect(payoutStatus('PROCESSING')).toEqual({ tone: 'awaiting', label: 'On its way' });
    expect(payoutStatus('SUCCEEDED')).toEqual({ tone: 'protected', label: 'Completed' });
    expect(payoutStatus('FAILED')).toEqual({ tone: 'risk', label: 'Didn’t go through' });
    expect(payoutStatus('REVERSED')).toEqual({ tone: 'risk', label: 'Returned' });
    expect(payoutStatus('NEEDS_REVIEW')).toEqual({ tone: 'verifying', label: 'Being checked' });
  });

  it('names every payout mode, weekly on Monday and monthly on the 1st', () => {
    expect(Object.keys(MODE_COPY)).toEqual([
      'MANUAL',
      'AUTO_IMMEDIATE',
      'AUTO_DAILY',
      'AUTO_WEEKLY',
      'AUTO_MONTHLY',
    ]);
    expect(MODE_COPY.AUTO_WEEKLY.detail).toContain('Monday');
    expect(MODE_COPY.AUTO_MONTHLY.detail).toContain('1st');
  });

  it('reads a typed naira amount as kobo, and refuses anything that is not one', () => {
    expect(parseNairaToKobo('1,200,000')).toBe('120000000');
    expect(parseNairaToKobo(' 452000.5 ')).toBe('45200050');
    expect(parseNairaToKobo('0.05')).toBe('5');
    expect(parseNairaToKobo('0')).toBe('0');
    expect(parseNairaToKobo('')).toBeUndefined();
    expect(parseNairaToKobo('12.345')).toBeUndefined();
    expect(parseNairaToKobo('-5')).toBeUndefined();
    expect(parseNairaToKobo('1e5')).toBeUndefined();
  });

  it('writes kobo back as the amount a person would type', () => {
    expect(koboToInput('120000000')).toBe('1,200,000');
    expect(koboToInput('45200050')).toBe('452,000.50');
    expect(koboToInput('5')).toBe('0.05');
  });

  it('words each refusal by its code, for the action that met it', () => {
    expect(payoutProblem(problem('PAYOUT_HELD'), 'withdraw')).toMatch(/paused/);
    expect(payoutProblem(problem('INSUFFICIENT_BALANCE'), 'withdraw')).toMatch(/available balance/);
    expect(payoutProblem(problem('PAYOUT_ACCOUNT_REQUIRED'), 'withdraw')).toMatch(/verified bank account/);
    expect(payoutProblem(problem('VALIDATION_FAILED', 422), 'withdraw')).toMatch(/too small/);
    expect(payoutProblem(problem('PAYOUT_ACCOUNT_REQUIRED'), 'schedule')).toMatch(/verified bank account/);
    expect(payoutProblem(problem('PAYOUT_ACCOUNT_REQUIRED'), 'remove-account')).toMatch(/automatic payouts/);
    expect(payoutProblem(problem('CONFLICT'), 'remove-account')).toMatch(/on its way/);
    expect(payoutProblem(problem('VALIDATION_FAILED', 422), 'add-account')).toMatch(/ten-digit/);
    expect(payoutProblem(problem('PAYMENT_PROVIDER_UNAVAILABLE', 503), 'add-account')).toMatch(/right now/);
    expect(payoutProblem(new Error('offline'), 'withdraw')).toMatch(/Nothing was sent/);
    expect(payoutProblem(problem('PAYOUT_HELD'), 'withdraw')).not.toContain('Title copy');
  });

  it('ends a withdrawal only on a definitive refusal, never on one that may have reached the platform', () => {
    expect(isDecidedRefusal(problem('VALIDATION_FAILED', 422))).toBe(true);
    expect(isDecidedRefusal(problem('NOT_FOUND', 404))).toBe(true);
    expect(isDecidedRefusal(problem('VALIDATION_FAILED', 400))).toBe(true);
    for (const status of [408, 409, 429, 500, 502, 503]) {
      expect(isDecidedRefusal(problem('ANY', status))).toBe(false);
    }
    expect(isDecidedRefusal(new Error('offline'))).toBe(false);
  });
});
