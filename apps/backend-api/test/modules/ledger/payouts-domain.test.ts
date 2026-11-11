// T-073's pure rules: the four payout journals, what a provider's transfer status means, which sweep
// modes are due on a given Lagos date, and the amounts a payout may have.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assertBalanced,
  initiatedPayoutLines,
  isPayoutReference,
  lagosDate,
  payoutAmounts,
  PayoutAmountError,
  payoutIdempotencyKey,
  payoutReference,
  returnedPayoutLines,
  reversedPayoutLines,
  settledPayoutLines,
  signedMinor,
  sweepKey,
  sweepModesDue,
  transferOutcome,
  type JournalLineInput,
} from '../../../src/modules/ledger/index.js';

const user = randomUUID();
const payout = randomUUID();

/** Every account's net movement, in its own direction, keyed by type. */
const net = (lines: JournalLineInput[]): Record<string, bigint> => {
  const out: Record<string, bigint> = {};
  for (const l of lines) {
    out[l.account.type] =
      (out[l.account.type] ?? 0n) + signedMinor(l.account.type, l.direction, l.amountMinor);
  }
  return out;
};

describe('payout references and keys', () => {
  it('is our reference, payout-<id>, in a shape the provider accepts', () => {
    const id = randomUUID();
    expect(payoutReference(id.toUpperCase())).toBe(`payout-${id}`);
    expect(isPayoutReference(`payout-${id}`)).toBe(true);
    expect(isPayoutReference(`fund-${id}`)).toBe(false);
    expect(isPayoutReference(`payout-${id}x`)).toBe(false);
    expect(payoutIdempotencyKey(id, 'initiated')).toBe(`payout:${id}:initiated`);
  });
});

describe('payout amounts', () => {
  it('sends the amount less the frozen fee', () => {
    expect(payoutAmounts(100_000n, 0n)).toEqual({
      amountMinor: 100_000n,
      feeMinor: 0n,
      transferAmountMinor: 100_000n,
    });
    expect(payoutAmounts(100_000n, 5_000n)).toEqual({
      amountMinor: 100_000n,
      feeMinor: 5_000n,
      transferAmountMinor: 95_000n,
    });
  });

  it('refuses nothing to send: zero, negative, or an amount the fee swallows', () => {
    for (const [amount, fee] of [
      [0n, 0n],
      [-1n, 0n],
      [5_000n, 5_000n],
      [4_999n, 5_000n],
      [100n, -1n],
    ] as const) {
      expect(() => payoutAmounts(amount, fee), `${amount}/${fee}`).toThrow(PayoutAmountError);
    }
  });
});

describe('payout journals', () => {
  const amounts = payoutAmounts(100_000n, 2_500n);
  const zeroFee = payoutAmounts(100_000n, 0n);

  it('initiation moves the payable into clearing, and the fee into revenue as its own line', () => {
    const lines = initiatedPayoutLines({ userId: user, payoutId: payout }, amounts);
    assertBalanced(lines);
    expect(net(lines)).toEqual({
      USER_PAYABLE: -100_000n,
      SETTLEMENT_CLEARING: 97_500n,
      PLATFORM_FEE_REVENUE: 2_500n,
    });
    // A zero fee has no line: a ledger line is strictly positive.
    expect(initiatedPayoutLines({ userId: user, payoutId: payout }, zeroFee)).toHaveLength(2);
  });

  it('leaves the payout clearing account at zero after every outcome', () => {
    // A seeded walk over many amounts and fees, the backend has no property-testing dependency.
    let seed = 0x2f6e2b1n;
    const next = (max: bigint): bigint => {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n;
      return seed % max;
    };
    for (let i = 0; i < 500; i += 1) {
      const send = next(10n ** 15n) + 1n;
      const fee = i % 5 === 0 ? 0n : next(10n ** 12n);
      const a = payoutAmounts(send + fee, fee);
      const parties = { userId: user, payoutId: payout };
      const initiated = initiatedPayoutLines(parties, a);
      for (const outcome of [
        [...initiated, ...settledPayoutLines(parties, a)],
        [...initiated, ...reversedPayoutLines(parties, a)],
        [...initiated, ...settledPayoutLines(parties, a), ...returnedPayoutLines(parties, a)],
      ]) {
        expect(net(outcome).SETTLEMENT_CLEARING ?? 0n).toBe(0n);
      }
      for (const lines of [
        initiated,
        settledPayoutLines(parties, a),
        reversedPayoutLines(parties, a),
        returnedPayoutLines(parties, a),
      ]) {
        assertBalanced(lines);
      }
    }
  });

  it('success takes the cash out of the pool; failure and return hand the whole debit back', () => {
    const parties = { userId: user, payoutId: payout };
    expect(net(settledPayoutLines(parties, amounts))).toEqual({
      SETTLEMENT_CLEARING: -97_500n,
      PLATFORM_ESCROW_POOL: -97_500n,
    });
    // WF1: "nothing was lost" — the fee comes back with the amount.
    expect(net(reversedPayoutLines(parties, amounts))).toEqual({
      SETTLEMENT_CLEARING: -97_500n,
      PLATFORM_FEE_REVENUE: -2_500n,
      USER_PAYABLE: 100_000n,
    });
    expect(net(returnedPayoutLines(parties, amounts))).toEqual({
      PLATFORM_ESCROW_POOL: 97_500n,
      PLATFORM_FEE_REVENUE: -2_500n,
      USER_PAYABLE: 100_000n,
    });
  });
});

describe('transfer outcomes', () => {
  it('reads only the statuses that are final as final', () => {
    expect(transferOutcome('success')).toBe('SUCCEEDED');
    expect(transferOutcome('failed')).toBe('FAILED');
    expect(transferOutcome('abandoned')).toBe('FAILED');
    expect(transferOutcome('reversed')).toBe('REVERSED');
    // Anything else, including a status nobody has seen before, is still in flight: guessing either
    // way is how a payout is paid twice or lost.
    expect(transferOutcome('rejected')).toBe('FAILED');
    for (const status of ['pending', 'processing', 'otp', 'queued', 'received', 'blocked', 'whatever']) {
      expect(transferOutcome(status), status).toBe('PENDING');
    }
  });
});

describe('the sweep calendar (Africa/Lagos)', () => {
  it('reads the date in Lagos, not UTC', () => {
    // 23:30 UTC on a Sunday is 00:30 on Monday in Lagos.
    expect(lagosDate(new Date('2026-11-15T23:30:00Z'))).toEqual({
      isoDate: '2026-11-16',
      weekday: 1,
      day: 16,
    });
  });

  it('sweeps daily users every day, weekly users on Monday, monthly users on the 1st', () => {
    expect(sweepModesDue(new Date('2026-11-11T08:00:00Z'))).toEqual(['AUTO_DAILY']); // a Wednesday
    expect(sweepModesDue(new Date('2026-11-16T08:00:00Z'))).toEqual(['AUTO_DAILY', 'AUTO_WEEKLY']); // Monday
    expect(sweepModesDue(new Date('2026-12-01T08:00:00Z'))).toEqual(['AUTO_DAILY', 'AUTO_MONTHLY']); // Tuesday 1st
    expect(sweepModesDue(new Date('2027-02-01T08:00:00Z'))).toEqual([
      'AUTO_DAILY',
      'AUTO_WEEKLY',
      'AUTO_MONTHLY',
    ]);
  });

  it('keys a sweep by mode, user and Lagos date, so one run a day pays once', () => {
    const at = new Date('2026-11-16T08:00:00Z');
    expect(sweepKey('AUTO_WEEKLY', user, at)).toBe(`AUTO_WEEKLY:${user}:2026-11-16`);
  });
});

describe('the payout vocabulary the screens share (T-073)', () => {
  it('is the schema’s own, word for word', async () => {
    const shared = await import('@komtru/shared-types');
    const schema = await import('../../../src/modules/ledger/infrastructure/postgres/schema/payouts.js');
    expect([...schema.PAYOUT_MODES]).toEqual([...shared.PAYOUT_MODES]);
    expect([...schema.PAYOUT_STATUSES]).toEqual([...shared.PAYOUT_STATUSES]);
    expect([...schema.PAYOUT_TRIGGERS]).toEqual([...shared.PAYOUT_TRIGGERS]);
    expect([...schema.PAYOUT_ACCOUNT_STATUSES]).toEqual([...shared.PAYOUT_ACCOUNT_STATUSES]);
  });
});
