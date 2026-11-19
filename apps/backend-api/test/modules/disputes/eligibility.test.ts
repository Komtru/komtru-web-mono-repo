// Who may appeal (M3 D5) and who may review (M3 D3), as pure rules. Both take everything they need
// as arguments — including the "shares a device or a payout instrument" lists T-080 asks for — so
// the rule is testable today even where the signal that feeds it does not exist yet.
import { describe, expect, it } from 'vitest';
import { appealEligibility } from '../../../src/modules/disputes/domain/appeal.js';
import { reviewerEligibility } from '../../../src/modules/disputes/domain/assignment.js';

const BUYER = '11111111-1111-4111-8111-111111111111';
const SELLER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const REVIEWER = '44444444-4444-4444-8444-444444444444';

const DECIDED_AT = new Date('2026-11-25T12:00:00.000Z');
const DEADLINE = new Date('2026-12-02T12:00:00.000Z');

const appeal = (over: Partial<Parameters<typeof appealEligibility>[0]> = {}) =>
  appealEligibility({
    status: 'DECIDED',
    appealDeadlineAt: DEADLINE,
    appealFiledAt: null,
    userId: BUYER,
    buyerUserId: BUYER,
    sellerUserId: SELLER,
    now: DECIDED_AT,
    ...over,
  });

describe('appealEligibility (M3 D5)', () => {
  it('lets either party appeal a decided case inside the window', () => {
    expect(appeal()).toEqual({ allowed: true });
    expect(appeal({ userId: SELLER })).toEqual({ allowed: true });
  });

  it('refuses anyone who is not a party', () => {
    expect(appeal({ userId: STRANGER })).toEqual({ allowed: false, reason: 'NOT_A_PARTY' });
  });

  it('refuses a case that has not been decided', () => {
    for (const status of ['MEDIATION', 'OPEN_EVIDENCE_COLLECTION', 'UNDER_REVIEW', 'CLOSED'] as const) {
      expect(appeal({ status })).toEqual({ allowed: false, reason: 'NOT_DECIDED' });
    }
  });

  it('allows exactly one appeal', () => {
    expect(appeal({ appealFiledAt: new Date('2026-11-26T00:00:00.000Z') })).toEqual({
      allowed: false,
      reason: 'ALREADY_APPEALED',
    });
  });

  it('refuses an appeal once the window has closed, deadline instant included', () => {
    expect(appeal({ now: DEADLINE })).toEqual({ allowed: false, reason: 'WINDOW_CLOSED' });
    expect(appeal({ now: new Date('2026-12-05T00:00:00.000Z') })).toEqual({
      allowed: false,
      reason: 'WINDOW_CLOSED',
    });
  });

  it('refuses when no window was ever set', () => {
    expect(appeal({ appealDeadlineAt: null })).toEqual({ allowed: false, reason: 'WINDOW_CLOSED' });
  });

  it('checks party membership before the window, so a stranger learns nothing about timing', () => {
    expect(appeal({ userId: STRANGER, now: new Date('2027-01-01T00:00:00.000Z') })).toEqual({
      allowed: false,
      reason: 'NOT_A_PARTY',
    });
  });
});

const review = (over: Partial<Parameters<typeof reviewerEligibility>[0]> = {}) =>
  reviewerEligibility({
    reviewerId: REVIEWER,
    buyerUserId: BUYER,
    sellerUserId: SELLER,
    originalReviewerId: null,
    isAppeal: false,
    sharedDeviceUserIds: [],
    sharedPayoutUserIds: [],
    ...over,
  });

describe('reviewerEligibility (M3 D3, T-080)', () => {
  it('allows an unconnected reviewer', () => {
    expect(review()).toEqual({ allowed: true });
  });

  it('refuses a reviewer who is a party to the case', () => {
    expect(review({ reviewerId: BUYER })).toEqual({ allowed: false, reason: 'IS_A_PARTY' });
    expect(review({ reviewerId: SELLER })).toEqual({ allowed: false, reason: 'IS_A_PARTY' });
  });

  it('refuses a reviewer who shares a device with a party', () => {
    expect(review({ sharedDeviceUserIds: [REVIEWER] })).toEqual({
      allowed: false,
      reason: 'SHARES_DEVICE',
    });
  });

  it('refuses a reviewer who shares a payout instrument with a party', () => {
    expect(review({ sharedPayoutUserIds: [REVIEWER] })).toEqual({
      allowed: false,
      reason: 'SHARES_PAYOUT_INSTRUMENT',
    });
  });

  it('ignores a shared-device list that does not name this reviewer', () => {
    expect(review({ sharedDeviceUserIds: [STRANGER], sharedPayoutUserIds: [STRANGER] })).toEqual({
      allowed: true,
    });
  });

  it('refuses the original reviewer on an appeal, and only on an appeal (M3 D5)', () => {
    expect(review({ isAppeal: true, originalReviewerId: REVIEWER })).toEqual({
      allowed: false,
      reason: 'ORIGINAL_REVIEWER',
    });
    // The same person reassigned to their own original review is not what D5 is about.
    expect(review({ isAppeal: false, originalReviewerId: REVIEWER })).toEqual({ allowed: true });
  });

  it('checks party membership before the original-reviewer rule', () => {
    expect(review({ reviewerId: BUYER, isAppeal: true, originalReviewerId: BUYER })).toEqual({
      allowed: false,
      reason: 'IS_A_PARTY',
    });
  });
});
