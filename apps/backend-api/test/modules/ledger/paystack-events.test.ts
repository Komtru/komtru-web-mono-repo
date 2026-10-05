import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePaystackEvent } from '../../../src/modules/ledger/infrastructure/providers/paystack/events.js';
import { ApiError } from '../../../src/platform/errors.js';

const FIXTURES = join(import.meta.dirname, 'fixtures/paystack');
const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, `${name}.json`));
/** Loads a fixture, applies an edit to its `data`, and re-serialises — for the malformed cases. */
const edited = (name: string, edit: (data: Record<string, unknown>) => void): Buffer => {
  const payload = JSON.parse(fixture(name).toString('utf8')) as { data: Record<string, unknown> };
  edit(payload.data);
  return Buffer.from(JSON.stringify(payload), 'utf8');
};
const body = (value: string): Buffer => Buffer.from(value, 'utf8');

describe('parsePaystackEvent', () => {
  it('normalizes charge.success', () => {
    expect(parsePaystackEvent(fixture('charge.success'))).toEqual({
      type: 'charge.succeeded',
      reference: 'trade_fund_018f3b2c',
      providerReference: 'trade_fund_018f3b2c',
      amountMinor: 15225000,
      paidAt: '2026-10-04T11:21:43.000Z',
    });
  });

  it('normalizes charge.failed', () => {
    expect(parsePaystackEvent(fixture('charge.failed'))).toEqual({
      type: 'charge.failed',
      reference: 'trade_fund_018f3b2d',
      providerReference: 'trade_fund_018f3b2d',
      reason: 'Insufficient funds',
    });
  });

  it('normalizes the three transfer events', () => {
    expect(parsePaystackEvent(fixture('transfer.success'))).toEqual({
      type: 'transfer.success',
      reference: 'payout_018f3b40',
      providerTransferId: 'TRF_vsyqdmlzble3uii',
    });
    expect(parsePaystackEvent(fixture('transfer.failed'))).toEqual({
      type: 'transfer.failed',
      reference: 'payout_018f3b41',
      providerTransferId: 'TRF_wsyqdmlzble3uij',
      reason: 'Account resolution failed at the receiving bank',
    });
    expect(parsePaystackEvent(fixture('transfer.reversed'))).toEqual({
      type: 'transfer.reversed',
      reference: 'payout_018f3b42',
      providerTransferId: 'TRF_xsyqdmlzble3uik',
    });
  });

  it('normalizes the four refund events, stringifying the numeric refund id', () => {
    expect(parsePaystackEvent(fixture('refund.pending'))).toEqual({
      type: 'refund.pending',
      reference: 'trade_fund_018f3b2c',
      providerRefundId: '88127',
    });
    expect(parsePaystackEvent(fixture('refund.processing'))).toMatchObject({
      type: 'refund.processing',
      reference: 'trade_fund_018f3b2c',
    });
    expect(parsePaystackEvent(fixture('refund.processed'))).toEqual({
      type: 'refund.processed',
      reference: 'trade_fund_018f3b2c',
      providerRefundId: '88129',
      amountMinor: 5000000,
    });
    expect(parsePaystackEvent(fixture('refund.failed'))).toEqual({
      type: 'refund.failed',
      reference: 'trade_fund_018f3b2c',
      providerRefundId: '88130',
      reason: 'The customer account could not be credited',
    });
  });

  it('falls back to a generic reason when a failed refund carries no message', () => {
    const payload = {
      event: 'refund.failed',
      data: { id: 88130, status: 'failed', transaction_reference: 'trade_fund_018f3b2c' },
    };
    // Never `status`: on a refund.failed event that reads 'failed', which says nothing.
    expect(parsePaystackEvent(body(JSON.stringify(payload)))).toMatchObject({
      reason: 'refund failed',
    });
  });

  it('refuses a refund event that identifies no original transaction', () => {
    // The old fallback put the refund's own id into a field documented as OUR reference.
    const payload = { event: 'refund.processed', data: { id: 88129, amount: 100, status: 'processed' } };
    expect(() => parsePaystackEvent(body(JSON.stringify(payload)))).toThrow(ApiError);
  });

  it('refuses a charge.success whose own data says it failed', () => {
    const payload = edited('charge.success', (data) => (data['status'] = 'failed'));
    expect(() => parsePaystackEvent(payload)).toThrow(ApiError);
  });

  it('reads a refund reference from the nested transaction object too', () => {
    const payload = {
      event: 'refund.processed',
      data: {
        id: 88131,
        amount: 100,
        status: 'processed',
        transaction: { reference: 'trade_fund_nested' },
      },
    };
    expect(parsePaystackEvent(body(JSON.stringify(payload)))).toMatchObject({
      reference: 'trade_fund_nested',
    });
  });

  it('returns null for an event this module does not act on', () => {
    expect(parsePaystackEvent(fixture('customeridentification.success'))).toBeNull();
  });

  it('returns null for an unknown event even when its data would be invalid for a known one', () => {
    // Unknown beats malformed: a new Paystack event type is not a delivery failure.
    expect(parsePaystackEvent(body('{"event":"invoice.create","data":{"amount":"lots"}}'))).toBeNull();
  });

  const malformed: [string, string][] = [
    ['not JSON at all', 'not json'],
    ['a JSON null', 'null'],
    ['a JSON array', '[]'],
    ['a JSON string', '"charge.success"'],
    ['a JSON number', '7'],
    ['an envelope with no event', '{"data":{}}'],
    ['an envelope whose event is not a string', '{"event":1,"data":{}}'],
    ['an envelope with no data', '{"event":"charge.success"}'],
    ['an envelope whose data is not an object', '{"event":"charge.success","data":"x"}'],
  ];

  it.each(malformed)('rejects %s with a 400, not a TypeError', (_name, raw) => {
    // The cannibalized parser destructured the body and threw a TypeError out of the handler.
    expect(() => parsePaystackEvent(body(raw))).toThrow(ApiError);
    try {
      parsePaystackEvent(body(raw));
    } catch (error) {
      expect((error as ApiError).status).toBe(400);
    }
  });

  const coercions: [string, (data: Record<string, unknown>) => void][] = [
    ['amount is missing', (data) => delete data['amount']],
    ['amount is a string', (data) => (data['amount'] = '15225000')],
    ['amount is negative', (data) => (data['amount'] = -1)],
    ['amount is fractional', (data) => (data['amount'] = 1.5)],
    ['reference is missing', (data) => delete data['reference']],
    ['reference is empty', (data) => (data['reference'] = '')],
    ['paid_at is null', (data) => (data['paid_at'] = null)],
  ];

  it.each(coercions)('rejects charge.success when %s rather than coercing it', (_name, edit) => {
    // The cannibalized parser coerced these to 0, '' and Date.now(), inventing a credit.
    expect(() => parsePaystackEvent(edited('charge.success', edit))).toThrow(ApiError);
  });

  it('keeps no field value in the error it raises', () => {
    try {
      parsePaystackEvent(edited('charge.success', (data) => (data['amount'] = 'ten million naira')));
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(JSON.stringify(error)).not.toContain('ten million naira');
      expect((error as ApiError).detail).toContain('charge.success');
    }
  });
});
