// T-072's pure half: what a funding charge is for, how it is posted, and when a verified charge may be
// believed. No infrastructure — the migration these feed is still pending (see the T-072 plan).
import { describe, expect, it } from 'vitest';
import {
  assertBalanced,
  assessVerifiedCharge,
  canSupersedeAttempt,
  FUNDING_FAILED_GRACE_MS,
  FUNDING_UNSEEN_GRACE_MS,
  MAX_ATTEMPTS_PER_TRADE,
  RESTART_MIN_INTERVAL_MS,
  FundingSnapshotError,
  fundingAmounts,
  fundingIdempotencyKey,
  fundingJournalLines,
  fundingReference,
  isFundingReference,
  journalIdempotencyKeySchema,
  PAYMENT_ATTEMPT_STATUSES,
  PAYSTACK_INLINE_CHANNELS,
  paymentDisplayState,
  paymentEscrowFundedEvent,
  type AttemptForVerify,
  type PaymentAttemptStatus,
  type TradeFundingSnapshot,
} from '../../../src/modules/ledger/index.js';

const TRADE = '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';
const ATTEMPT = '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a';

const snapshot = (overrides: Partial<TradeFundingSnapshot> = {}): TradeFundingSnapshot => ({
  tradeId: TRADE,
  currency: 'NGN',
  feeScheduleVersion: '2026-10-05.1',
  itemAmountMinor: 45_000_000n,
  buyerProtectionFeeMinor: 675_000n,
  buyerTotalMinor: 45_675_000n,
  ...overrides,
});

describe('the funding reference', () => {
  it('is one per attempt, in the characters Paystack accepts', () => {
    const reference = fundingReference(ATTEMPT);
    expect(reference).toBe(`fund-${ATTEMPT}`);
    // Paystack: alphanumerics, '-', '.', '=' only. An underscore is refused at initialize.
    expect(reference).toMatch(/^[A-Za-z0-9.=-]+$/);
    expect(isFundingReference(reference)).toBe(true);
  });

  it('normalises an upper-case attempt id, so one attempt has one reference', () => {
    expect(fundingReference(ATTEMPT.toUpperCase())).toBe(fundingReference(ATTEMPT));
  });

  it('refuses anything that is not an attempt id', () => {
    expect(() => fundingReference('not-a-uuid')).toThrow();
    expect(isFundingReference('trade_fund_123')).toBe(false);
    expect(isFundingReference(`fund-${ATTEMPT}x`)).toBe(false);
  });

  it('keys the posting by the charge, in the journal key shape', () => {
    const key = fundingIdempotencyKey(fundingReference(ATTEMPT));
    expect(key).toBe(`charge:fund-${ATTEMPT}`);
    expect(journalIdempotencyKeySchema.safeParse(key).success).toBe(true);
  });
});

describe('the funding amounts', () => {
  it('are the trade snapshot: item plus the buyer protection fee', () => {
    expect(fundingAmounts(snapshot())).toEqual({
      currency: 'NGN',
      feeScheduleVersion: '2026-10-05.1',
      itemAmountMinor: 45_000_000n,
      buyerProtectionFeeMinor: 675_000n,
      totalMinor: 45_675_000n,
    });
  });

  it('accept a zero fee', () => {
    const amounts = fundingAmounts(snapshot({ buyerProtectionFeeMinor: 0n, buyerTotalMinor: 45_000_000n }));
    expect(amounts.totalMinor).toBe(45_000_000n);
  });

  it.each([
    ['no snapshot at all', { feeScheduleVersion: null, itemAmountMinor: null }],
    ['a missing fee', { buyerProtectionFeeMinor: null }],
    ['a missing total', { buyerTotalMinor: null }],
    ['a total that does not add up', { buyerTotalMinor: 45_675_001n }],
    ['a zero item', { itemAmountMinor: 0n, buyerTotalMinor: 675_000n }],
    ['a negative fee', { buyerProtectionFeeMinor: -1n, buyerTotalMinor: 44_999_999n }],
    ['another currency', { currency: 'USD' }],
  ] as const)('are refused for %s, never recomputed', (_label, overrides) => {
    expect(() => fundingAmounts(snapshot(overrides as Partial<TradeFundingSnapshot>))).toThrow(
      FundingSnapshotError,
    );
  });
});

describe('the funding posting', () => {
  it('debits the pool the total and holds item and fee as the trade’s liability', () => {
    const lines = fundingJournalLines(TRADE, fundingAmounts(snapshot()));

    expect(lines).toEqual([
      { account: { type: 'PLATFORM_ESCROW_POOL' }, direction: 'DEBIT', amountMinor: 45_675_000n },
      {
        account: { type: 'USER_ESCROW_LIABILITY', tradeId: TRADE },
        direction: 'CREDIT',
        amountMinor: 45_000_000n,
      },
      {
        account: { type: 'USER_ESCROW_LIABILITY', tradeId: TRADE },
        direction: 'CREDIT',
        amountMinor: 675_000n,
      },
    ]);
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it('recognises no revenue at funding', () => {
    const lines = fundingJournalLines(TRADE, fundingAmounts(snapshot()));
    const types = lines.map((line) => line.account.type);
    expect(types).not.toContain('BUYER_PROTECTION_FEE_REVENUE');
    expect(types).not.toContain('PLATFORM_FEE_REVENUE');
  });

  it('omits the fee line when the fee is zero, since a line is strictly positive', () => {
    const lines = fundingJournalLines(
      TRADE,
      fundingAmounts(snapshot({ buyerProtectionFeeMinor: 0n, buyerTotalMinor: 45_000_000n })),
    );
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.amountMinor > 0n)).toBe(true);
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it('refuses amounts that were not produced by fundingAmounts', () => {
    expect(() =>
      fundingJournalLines(TRADE, {
        ...fundingAmounts(snapshot()),
        totalMinor: 1n,
      }),
    ).toThrow(FundingSnapshotError);
  });
});

describe('believing a verified charge', () => {
  const attempt = (overrides: Partial<AttemptForVerify> = {}): AttemptForVerify => ({
    reference: fundingReference(ATTEMPT),
    currency: 'NGN',
    amountMinor: 45_675_000n,
    status: 'PENDING',
    ...overrides,
  });
  const verified = (overrides: Partial<Parameters<typeof assessVerifiedCharge>[1]> = {}) => ({
    reference: fundingReference(ATTEMPT),
    status: 'success',
    amountMinor: 45_675_000,
    currency: 'NGN',
    ...overrides,
  });

  it('posts only an exact match on reference, amount, currency and success', () => {
    expect(assessVerifiedCharge(attempt(), verified())).toEqual({ kind: 'POST' });
    expect(assessVerifiedCharge(attempt({ status: 'INITIATED' }), verified())).toEqual({
      kind: 'POST',
    });
  });

  it.each([
    ['an under-payment', { amountMinor: 45_674_999 }],
    ['an over-payment', { amountMinor: 45_675_001 }],
    ['another currency', { currency: 'USD' }],
    ['another reference', { reference: `fund-${TRADE}` }],
    ['an amount past exact integers', { amountMinor: Number.MAX_SAFE_INTEGER + 2 }],
  ])('holds %s for review and posts nothing', (_label, overrides) => {
    expect(assessVerifiedCharge(attempt(), verified(overrides)).kind).toBe('NEEDS_REVIEW');
  });

  it('holds a reversed charge for review', () => {
    expect(assessVerifiedCharge(attempt(), verified({ status: 'reversed' })).kind).toBe('NEEDS_REVIEW');
  });

  it.each(['abandoned', 'failed'])(
    'leaves a %s charge open, because a transfer or another card can still land',
    (status) => {
      expect(assessVerifiedCharge(attempt(), verified({ status }))).toEqual({
        kind: 'NOT_CONFIRMED',
        providerStatus: status,
      });
    },
  );

  it.each(['ongoing', 'pending', 'processing', 'queued', 'something-new'])(
    'retries a charge still %s',
    (status) => {
      expect(assessVerifiedCharge(attempt(), verified({ status }))).toEqual({
        kind: 'PENDING',
        providerStatus: status,
      });
    },
  );

  it('does nothing for an attempt that already succeeded: a replay is a no-op', () => {
    expect(assessVerifiedCharge(attempt({ status: 'SUCCEEDED' }), verified()).kind).toBe('NO_OP');
  });

  it.each(['FAILED', 'ABANDONED', 'NEEDS_REVIEW'] as const)(
    'holds money that arrives on a %s attempt for review',
    (status) => {
      expect(assessVerifiedCharge(attempt({ status }), verified()).kind).toBe('NEEDS_REVIEW');
      expect(assessVerifiedCharge(attempt({ status }), verified({ status: 'failed' })).kind).toBe('NO_OP');
    },
  );
});

const NOW = new Date('2026-11-07T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

/** An attempt's progress, `minutes` after it was initiated, seen by the provider or not. */
const progress = (
  status: PaymentAttemptStatus,
  lastProviderStatus: string | null,
  { minutes = 1, seen = lastProviderStatus !== null && lastProviderStatus !== 'not_found' } = {},
) => ({
  status,
  lastProviderStatus,
  initiatedAt: minutesAgo(minutes),
  providerSeenAt: seen ? minutesAgo(minutes) : null,
});

describe('the funding grace periods', () => {
  it('are thirty minutes for a reference the provider never saw, ten for a declined card', () => {
    expect(FUNDING_UNSEEN_GRACE_MS).toBe(30 * 60_000);
    expect(FUNDING_FAILED_GRACE_MS).toBe(10 * 60_000);
    expect(MAX_ATTEMPTS_PER_TRADE).toBe(10);
    expect(RESTART_MIN_INTERVAL_MS).toBeGreaterThan(0);
  });
});

describe('the buyer-facing payment state (AB3, AB4)', () => {
  it.each([
    ['INITIATED', null, 1, 'AWAITING_PAYMENT'],
    ['PENDING', null, 1, 'VERIFYING'],
    ['PENDING', 'ongoing', 1, 'VERIFYING'],
    // A transfer the provider says is in flight stays "verifying", however long it takes.
    ['PENDING', 'ongoing', 120, 'VERIFYING'],
    ['PENDING', 'abandoned', 1, 'NOT_CONFIRMED'],
    ['PENDING', 'failed', 1, 'NOT_CONFIRMED'],
    ['PENDING', 'not_found', 1, 'NOT_CONFIRMED'],
    // Never seen by the provider, past the grace: not stuck on "verifying" forever.
    ['PENDING', null, 31, 'NOT_CONFIRMED'],
    ['SUCCEEDED', 'success', 1, 'CONFIRMED'],
    ['FAILED', 'failed', 1, 'NOT_CONFIRMED'],
    ['ABANDONED', null, 1, 'NOT_CONFIRMED'],
    // Money may have arrived: never tell this buyer "nothing has been charged".
    ['NEEDS_REVIEW', 'success', 1, 'UNDER_REVIEW'],
  ] as const)('%s with provider status %s after %i min is %s', (status, last, minutes, expected) => {
    expect(paymentDisplayState(progress(status, last, { minutes }), NOW)).toBe(expected);
  });

  it('covers every attempt status', () => {
    for (const status of PAYMENT_ATTEMPT_STATUSES) {
      expect(paymentDisplayState(progress(status, null), NOW)).toEqual(expect.any(String));
    }
  });
});

describe('starting over with a new reference', () => {
  it.each([
    // Unseen by the provider: only after the thirty-minute grace, verified or not.
    ['INITIATED', null, 5, false],
    ['INITIATED', null, 31, true],
    ['PENDING', null, 5, false],
    ['PENDING', 'not_found', 5, false],
    ['PENDING', 'not_found', 31, true],
    // The provider says the buyer walked away: at once.
    ['PENDING', 'abandoned', 1, true],
    // A declined card can be retried on the same reference inside Inline: ten minutes.
    ['PENDING', 'failed', 5, false],
    ['PENDING', 'failed', 11, true],
    // Seen and still in flight: never.
    ['PENDING', 'ongoing', 300, false],
    ['SUCCEEDED', 'success', 300, false],
    ['NEEDS_REVIEW', 'success', 300, false],
  ] as const)('%s with provider status %s after %i min: %s', (status, last, minutes, expected) => {
    expect(canSupersedeAttempt(progress(status, last, { minutes }), NOW)).toBe(expected);
  });
});

describe('the Inline channels (V1, V2; C8)', () => {
  it('are card, USSD and pay-with-transfer, and nothing that settles on the provider schedule', () => {
    expect([...PAYSTACK_INLINE_CHANNELS]).toEqual(['card', 'ussd', 'bank_transfer']);
  });
});

describe('ledger.payment.escrow_funded', () => {
  it('carries the trade, the attempt and the amounts as kobo strings', () => {
    expect(paymentEscrowFundedEvent.eventType).toBe('ledger.payment.escrow_funded');
    const payload = {
      tradeId: TRADE,
      paymentAttemptId: ATTEMPT,
      journalEntryId: ATTEMPT,
      provider: 'PAYSTACK',
      reference: fundingReference(ATTEMPT),
      currency: 'NGN',
      amountMinor: '45675000',
      itemAmountMinor: '45000000',
      buyerProtectionFeeMinor: '675000',
      fundedAt: '2026-11-07T10:14:00.000Z',
    };
    expect(paymentEscrowFundedEvent.payload.safeParse(payload).success).toBe(true);
    expect(paymentEscrowFundedEvent.payload.safeParse({ ...payload, amountMinor: 45675000 }).success).toBe(
      false,
    );
  });
});
