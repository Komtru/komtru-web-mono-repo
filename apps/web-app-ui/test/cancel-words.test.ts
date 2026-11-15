// F-030 (T-119): what the cancellation screens may say, as pure functions. Each one takes only what the platform
// answered for THIS trade; none of them adds, subtracts or assumes a money amount.
import { describe, expect, it } from 'vitest';
import { refundRow as refund } from './support/workspace';
import { feeTreatmentWords, paymentGuard, reasonLabel, refundStage } from '../src/trade/cancel/words';

describe('reasonLabel', () => {
  it('words every reason the platform defines, buyer and seller', () => {
    expect(reasonLabel('CHANGED_MIND')).toBe('Changed my mind');
    expect(reasonLabel('FOUND_CHEAPER')).toBe('Found it elsewhere for less');
    expect(reasonLabel('ORDERED_BY_MISTAKE')).toBe('Ordered by mistake');
    expect(reasonLabel('OUT_OF_STOCK')).toBe('Out of stock');
    expect(reasonLabel('WRONG_PRICE')).toBe('Listed at the wrong price');
    expect(reasonLabel('CANNOT_MEET_TIMELINE')).toBe('Can’t meet the delivery timeline');
    expect(reasonLabel('OTHER')).toBe('Something else');
  });
});

describe('paymentGuard (CT1: cancelling a trade nobody has been confirmed to have paid for)', () => {
  it('offers the cancel plainly only when the platform sees no payment attempt', () => {
    expect(paymentGuard({ state: 'read', displayState: 'NONE' })).toBe('free');
  });
  it('asks for an explicit tick while a transfer may still be on its way', () => {
    expect(paymentGuard({ state: 'read', displayState: 'AWAITING_PAYMENT' })).toBe('confirm');
  });
  it.each(['VERIFYING', 'CONFIRMED', 'UNDER_REVIEW', 'NOT_CONFIRMED'] as const)(
    'offers no cancel when the payment is %s: money may have landed or still can',
    (displayState) => {
      expect(paymentGuard({ state: 'read', displayState })).toBe('blocked');
    },
  );
  it('offers no cancel while the status is loading or could not be read', () => {
    expect(paymentGuard({ state: 'loading' })).toBe('checking');
    expect(paymentGuard({ state: 'failed' })).toBe('unknown');
  });
  it('does not ask at all for a reader the guard does not apply to', () => {
    expect(paymentGuard({ state: 'not-needed' })).toBe('free');
  });
});

describe('refundStage (CR3, SC2: only a PROCESSED refund is "issued")', () => {
  it('says nothing about money when there is no refund row', () => {
    expect(refundStage([]).stage).toBe('none');
  });
  it('treats REQUESTED and PROCESSING as on the way, not issued', () => {
    expect(refundStage([refund('REQUESTED')]).stage).toBe('on-its-way');
    expect(refundStage([refund('PROCESSING')]).stage).toBe('on-its-way');
  });
  it('calls a PROCESSED refund issued', () => {
    expect(refundStage([refund('PROCESSED')]).stage).toBe('issued');
  });
  it('treats FAILED and NEEDS_REVIEW as held', () => {
    expect(refundStage([refund('FAILED')]).stage).toBe('held');
    expect(refundStage([refund('NEEDS_REVIEW')]).stage).toBe('held');
  });
  it('reads the newest refund, which the platform lists first', () => {
    const newest = refund('PROCESSING', { id: 'a' });
    expect(refundStage([newest, refund('FAILED', { id: 'b' })]).refund?.id).toBe('a');
  });
});

describe('feeTreatmentWords', () => {
  it('words what the platform did with the buyer protection fee, never what it ought to have done', () => {
    expect(feeTreatmentWords('REFUND')).toBe('Returned with your refund');
    expect(feeTreatmentWords('RECOGNISE')).toBe('Kept by Komtru');
    expect(feeTreatmentWords('RETAIN')).toBe('Kept by Komtru');
  });
});
