// M3 D4: the outcome set is constrained and the arithmetic is checked before anything is written.
// Pure bigint kobo throughout. The database trigger (M3 §5) re-checks the same sum independently —
// these are the application's half of "two checks, not one, on money movement".
import { describe, expect, it } from 'vitest';
import {
  MEDIATION_OUTCOMES,
  amountsForOutcome,
  assertDecisionSums,
} from '../../../src/modules/disputes/domain/decision.js';

/** ₦452,000 — the reference's own figure on Customer-7, Customer-8, H1 and Y1. */
const ESCROW = 45_200_000n;

/**
 * `ApiError` puts the title in `message` and the arithmetic in `detail`, so a refusal is asserted
 * on the detail: that is the sentence that says which rule was broken.
 */
const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as { detail?: string }).detail ?? String(error);
  }
  throw new Error('expected a refusal, but nothing was thrown');
};

describe('amountsForOutcome', () => {
  it('derives both amounts for a full refund', () => {
    expect(amountsForOutcome('REFUND_BUYER_FULL', ESCROW)).toEqual({
      toBuyerMinor: ESCROW,
      toSellerMinor: 0n,
    });
  });

  it('derives both amounts for a full release', () => {
    expect(amountsForOutcome('RELEASE_SELLER_FULL', ESCROW)).toEqual({
      toBuyerMinor: 0n,
      toSellerMinor: ESCROW,
    });
  });

  it('completes the other side of a partial from the one the caller named', () => {
    expect(amountsForOutcome('REFUND_BUYER_PARTIAL', ESCROW, { toBuyerMinor: 20_000_000n })).toEqual({
      toBuyerMinor: 20_000_000n,
      toSellerMinor: 25_200_000n,
    });
    expect(amountsForOutcome('RELEASE_SELLER_PARTIAL', ESCROW, { toSellerMinor: 30_000_000n })).toEqual({
      toBuyerMinor: 15_200_000n,
      toSellerMinor: 30_000_000n,
    });
  });

  it('refuses a partial with no amount named', () => {
    expect(() => amountsForOutcome('REFUND_BUYER_PARTIAL', ESCROW)).toThrow(/amount/i);
  });
});

describe('assertDecisionSums', () => {
  it('accepts a pair that sums to the escrowed total', () => {
    expect(() =>
      assertDecisionSums('REFUND_BUYER_PARTIAL', { toBuyerMinor: 1n, toSellerMinor: ESCROW - 1n }, ESCROW),
    ).not.toThrow();
  });

  it('refuses a pair that loses money', () => {
    expect(
      refusal(() => assertDecisionSums('REFUND_BUYER_PARTIAL', { toBuyerMinor: 1n, toSellerMinor: 1n }, 3n)),
    ).toMatch(/do not sum to the escrowed total 3/i);
  });

  it('refuses a pair that invents money', () => {
    expect(
      refusal(() => assertDecisionSums('REFUND_BUYER_PARTIAL', { toBuyerMinor: 2n, toSellerMinor: 2n }, 3n)),
    ).toMatch(/do not sum to the escrowed total 3/i);
  });

  it('refuses a negative share even when the pair sums correctly', () => {
    expect(
      refusal(() =>
        assertDecisionSums('REFUND_BUYER_PARTIAL', { toBuyerMinor: 101n, toSellerMinor: -1n }, 100n),
      ),
    ).toMatch(/negative/i);
  });

  it('refuses a partial that is really a full outcome mislabelled', () => {
    expect(
      refusal(() =>
        assertDecisionSums('RELEASE_SELLER_PARTIAL', { toBuyerMinor: 0n, toSellerMinor: 100n }, 100n),
      ),
    ).toMatch(/partial outcome, but one side gets nothing/i);
    expect(
      refusal(() =>
        assertDecisionSums('REFUND_BUYER_PARTIAL', { toBuyerMinor: 100n, toSellerMinor: 0n }, 100n),
      ),
    ).toMatch(/partial outcome, but one side gets nothing/i);
  });

  it('refuses a full outcome whose amounts are not the ones it implies', () => {
    expect(() =>
      assertDecisionSums('REFUND_BUYER_FULL', { toBuyerMinor: 60n, toSellerMinor: 40n }, 100n),
    ).toThrow();
  });

  it('refuses a zero or negative escrow', () => {
    expect(() =>
      assertDecisionSums('REFUND_BUYER_FULL', { toBuyerMinor: 0n, toSellerMinor: 0n }, 0n),
    ).toThrow();
  });
});

describe('the two functions together', () => {
  // Deliberately no `outcomeFor`: M3 D4 gives a split two names, REFUND_BUYER_PARTIAL and
  // RELEASE_SELLER_PARTIAL, and says nothing about which one a given pair of amounts deserves.
  // Deriving the label from which side got more would invent that rule. The decider names the
  // outcome; these functions only check that the amounts are a legal way to express it.
  it('round-trips every outcome through its own hint', () => {
    const hints = {
      REFUND_BUYER_FULL: undefined,
      RELEASE_SELLER_FULL: undefined,
      REFUND_BUYER_PARTIAL: { toBuyerMinor: 60n },
      RELEASE_SELLER_PARTIAL: { toSellerMinor: 40n },
    } as const;
    for (const outcome of MEDIATION_OUTCOMES) {
      const amounts = amountsForOutcome(outcome, 100n, hints[outcome]);
      expect(amounts.toBuyerMinor + amounts.toSellerMinor).toBe(100n);
      expect(() => assertDecisionSums(outcome, amounts, 100n)).not.toThrow();
    }
  });

  it('accepts a split labelled either way round', () => {
    const split = { toBuyerMinor: 60n, toSellerMinor: 40n };
    expect(() => assertDecisionSums('REFUND_BUYER_PARTIAL', split, 100n)).not.toThrow();
    expect(() => assertDecisionSums('RELEASE_SELLER_PARTIAL', split, 100n)).not.toThrow();
  });
});

describe('MEDIATION_OUTCOMES', () => {
  it('is M3 D4 unchanged — what the parties may agree is what a reviewer could have decided', () => {
    expect([...MEDIATION_OUTCOMES]).toEqual([
      'REFUND_BUYER_FULL',
      'REFUND_BUYER_PARTIAL',
      'RELEASE_SELLER_FULL',
      'RELEASE_SELLER_PARTIAL',
    ]);
  });
});
