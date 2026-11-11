import { describe, expect, it } from 'vitest';
import { PAYOUT_MODES, PROBLEM_CODES, payoutModeSchema, payoutStatusSchema } from '../src/index.js';

describe('payout vocabulary (T-073)', () => {
  it('names the five modes T-073 lists, manual first', () => {
    expect(PAYOUT_MODES).toEqual(['MANUAL', 'AUTO_IMMEDIATE', 'AUTO_DAILY', 'AUTO_WEEKLY', 'AUTO_MONTHLY']);
    expect(payoutModeSchema.safeParse('AUTO_HOURLY').success).toBe(false);
  });

  it('keeps the final statuses distinct from the in-flight ones', () => {
    expect(payoutStatusSchema.options).toEqual([
      'REQUESTED',
      'PROCESSING',
      'SUCCEEDED',
      'FAILED',
      'REVERSED',
      'NEEDS_REVIEW',
    ]);
  });

  it('gives each withdrawal refusal a code of its own', () => {
    for (const code of ['PAYOUT_ACCOUNT_REQUIRED', 'INSUFFICIENT_BALANCE', 'PAYOUT_HELD']) {
      expect(PROBLEM_CODES).toContain(code);
    }
  });
});
