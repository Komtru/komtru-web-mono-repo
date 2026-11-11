// T-075's pure half: what a refund decision and a failed refund post, and what the provider's record
// of a refund means. The amounts are named, never derived — a test that recomputes the thing under
// test proves nothing.
import { describe, expect, it } from 'vitest';
import { assertBalanced, journalIdempotencyKeySchema } from '../../../src/modules/ledger/domain/journal.js';
import {
  describeRefundMismatch,
  isRefundReference,
  planRefund,
  refundFailureLines,
  refundIdempotencyKey,
  refundOutcome,
  refundReference,
  RefundRequestError,
} from '../../../src/modules/ledger/domain/refunds.js';
import { releaseAmounts, ReleaseSnapshotError } from '../../../src/modules/ledger/domain/release.js';

const TRADE = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a11';
const REFUND = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a33';

const ITEM = 45_000_000n;
const FEE = 675_000n;
const COMMISSION = 900_000n;

const storedSnapshot = (refundable = true) => ({
  version: 'test-fee-schedule',
  currency: 'NGN',
  takenAt: '2026-11-09T09:00:00.000Z',
  sellerKind: 'CASUAL',
  amounts: {
    itemMinor: ITEM.toString(),
    buyerProtectionFeeMinor: FEE.toString(),
    buyerTotalMinor: (ITEM + FEE).toString(),
    commissionMinor: COMMISSION.toString(),
    sellerProceedsMinor: (ITEM - COMMISSION).toString(),
    platformRevenueMinor: (FEE + COMMISSION).toString(),
  },
  terms: {
    buyerProtectionBps: 150,
    buyerProtectionMinMinor: '0',
    buyerProtectionMaxMinor: null,
    buyerProtectionRefundableOnFullRefund: refundable,
    commissionBps: 0,
    commissionMinMinor: '0',
    commissionMaxMinor: null,
  },
});

const amounts = (feeSnapshot: unknown = storedSnapshot(), fee = FEE) =>
  releaseAmounts({
    tradeId: TRADE,
    currency: 'NGN',
    feeScheduleVersion: 'test-fee-schedule',
    itemAmountMinor: ITEM,
    buyerProtectionFeeMinor: fee,
    commissionMinor: COMMISSION,
    sellerProceedsMinor: ITEM - COMMISSION,
    feeSnapshot,
  });

const asJournal = (lines: { account: { type: string }; direction: string; amountMinor: bigint }[]) =>
  lines.map((line) => `${line.direction} ${line.account.type} ${line.amountMinor}`);

describe('refund references and keys', () => {
  it('names a refund by its id', () => {
    expect(refundReference(REFUND)).toBe(`refund-${REFUND}`);
    expect(refundReference(REFUND.toUpperCase())).toBe(`refund-${REFUND}`);
    expect(isRefundReference(refundReference(REFUND))).toBe(true);
    expect(isRefundReference(`fund-${REFUND}`)).toBe(false);
  });

  it('keys each stage by the refund, in a shape the journal accepts', () => {
    expect(refundIdempotencyKey(REFUND, 'decided')).toBe(`refund:${REFUND}:decided`);
    expect(refundIdempotencyKey(REFUND, 'failed')).toBe(`refund:${REFUND}:failed`);
    expect(journalIdempotencyKeySchema.parse(refundIdempotencyKey(REFUND, 'decided'))).toBeTypeOf('string');
    expect(() => refundIdempotencyKey('nope', 'decided')).toThrow();
  });
});

describe('planning a full refund (Q4)', () => {
  it('refunds the item and the fee when the trade froze the fee as refundable', () => {
    const plan = planRefund(TRADE, amounts(), { scope: 'FULL' });
    expect(plan).toMatchObject({
      scope: 'FULL',
      itemAmountMinor: ITEM,
      feeAmountMinor: FEE,
      amountMinor: ITEM + FEE,
      feeTreatment: 'REFUND',
    });
    expect(asJournal(plan.lines)).toEqual([
      `DEBIT USER_ESCROW_LIABILITY ${ITEM}`,
      `CREDIT PLATFORM_ESCROW_POOL ${ITEM}`,
      `DEBIT BUYER_PROTECTION_FEE_LIABILITY ${FEE}`,
      `CREDIT PLATFORM_ESCROW_POOL ${FEE}`,
    ]);
    expect(() => assertBalanced(plan.lines)).not.toThrow();
  });

  it('refunds the item only, and earns the fee, when the trade froze it as not refundable', () => {
    const plan = planRefund(TRADE, amounts(storedSnapshot(false)), { scope: 'FULL' });
    expect(plan).toMatchObject({
      itemAmountMinor: ITEM,
      feeAmountMinor: 0n,
      amountMinor: ITEM,
      feeTreatment: 'RECOGNISE',
    });
    expect(asJournal(plan.lines)).toEqual([
      `DEBIT USER_ESCROW_LIABILITY ${ITEM}`,
      `CREDIT PLATFORM_ESCROW_POOL ${ITEM}`,
      `DEBIT BUYER_PROTECTION_FEE_LIABILITY ${FEE}`,
      `CREDIT BUYER_PROTECTION_FEE_REVENUE ${FEE}`,
    ]);
  });

  it('posts no fee line at all for a zero fee', () => {
    const plan = planRefund(TRADE, amounts(storedSnapshot(), 0n), { scope: 'FULL' });
    expect(plan.amountMinor).toBe(ITEM);
    expect(asJournal(plan.lines)).toEqual([
      `DEBIT USER_ESCROW_LIABILITY ${ITEM}`,
      `CREDIT PLATFORM_ESCROW_POOL ${ITEM}`,
    ]);
  });

  it('refuses an unreadable stored snapshot rather than guessing which way the fee goes', () => {
    expect(() => planRefund(TRADE, amounts({ not: 'a snapshot' }), { scope: 'FULL' })).toThrow(
      ReleaseSnapshotError,
    );
  });
});

describe('planning a partial refund', () => {
  it('moves item money only and retains the fee', () => {
    const plan = planRefund(TRADE, amounts(), { scope: 'PARTIAL', itemAmountMinor: 10_000_000n });
    expect(plan).toMatchObject({
      scope: 'PARTIAL',
      itemAmountMinor: 10_000_000n,
      feeAmountMinor: 0n,
      amountMinor: 10_000_000n,
      feeTreatment: 'RETAIN',
    });
    expect(asJournal(plan.lines)).toEqual([
      'DEBIT USER_ESCROW_LIABILITY 10000000',
      'CREDIT PLATFORM_ESCROW_POOL 10000000',
    ]);
  });

  it('refuses nothing, everything and more than everything', () => {
    for (const part of [0n, -1n, ITEM, ITEM + 1n]) {
      expect(() => planRefund(TRADE, amounts(), { scope: 'PARTIAL', itemAmountMinor: part })).toThrow(
        RefundRequestError,
      );
    }
  });
});

describe('the failure journal', () => {
  it('puts the cash-out legs of a full refund back where they came from', () => {
    const lines = refundFailureLines(TRADE, { itemAmountMinor: ITEM, feeAmountMinor: FEE });
    expect(asJournal(lines)).toEqual([
      `DEBIT PLATFORM_ESCROW_POOL ${ITEM + FEE}`,
      `CREDIT USER_ESCROW_LIABILITY ${ITEM}`,
      `CREDIT BUYER_PROTECTION_FEE_LIABILITY ${FEE}`,
    ]);
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it('leaves a fee that was earned, earned', () => {
    expect(asJournal(refundFailureLines(TRADE, { itemAmountMinor: ITEM, feeAmountMinor: 0n }))).toEqual([
      `DEBIT PLATFORM_ESCROW_POOL ${ITEM}`,
      `CREDIT USER_ESCROW_LIABILITY ${ITEM}`,
    ]);
  });

  it('refuses a negative amount rather than dropping a leg', () => {
    expect(() => refundFailureLines(TRADE, { itemAmountMinor: ITEM, feeAmountMinor: -1n })).toThrow(
      RefundRequestError,
    );
  });
});

describe("the provider's record of a refund", () => {
  it('maps the documented statuses, and treats anything else as still on its way', () => {
    expect(refundOutcome('processed')).toBe('PROCESSED');
    expect(refundOutcome('PROCESSED')).toBe('PROCESSED');
    expect(refundOutcome('failed')).toBe('FAILED');
    expect(refundOutcome('pending')).toBe('PENDING');
    expect(refundOutcome('processing')).toBe('PENDING');
    expect(refundOutcome('needs-attention')).toBe('PENDING');
  });

  it('names the difference when the record is not this refund', () => {
    const refund = { amountMinor: ITEM + FEE, currency: 'NGN', providerRefundId: '991' };
    const verified = {
      providerRefundId: '991',
      status: 'processed',
      amountMinor: Number(ITEM + FEE),
      currency: 'NGN',
    };
    expect(describeRefundMismatch(refund, verified)).toBeUndefined();
    expect(describeRefundMismatch(refund, { ...verified, currency: 'ngn' })).toBeUndefined();
    expect(describeRefundMismatch(refund, { ...verified, amountMinor: Number(ITEM) })).toMatch(/is for/);
    expect(describeRefundMismatch(refund, { ...verified, currency: 'USD' })).toMatch(/USD/);
    expect(describeRefundMismatch(refund, { ...verified, providerRefundId: '992' })).toMatch(/992/);
    expect(describeRefundMismatch(refund, { ...verified, amountMinor: 1.5 })).toMatch(/is for/);
  });
});
