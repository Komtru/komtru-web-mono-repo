import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client.js';
import {
  confirmPayment,
  getPaymentStatus,
  initiatePayment,
  initiatedPaymentSchema,
  paymentStatusSchema,
} from '../src/payments.js';

const id = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const attempt = {
  id: id(7),
  reference: `fund-${id(7)}`,
  status: 'INITIATED',
  displayState: 'AWAITING_PAYMENT',
  currency: 'NGN',
  amountMinor: '45878000',
  itemAmountMinor: '45200000',
  buyerProtectionFeeMinor: '678000',
  initiatedAt: '2026-11-10T09:00:00.000Z',
  confirmedAt: null,
};
const initiated = {
  tradeId: id(1),
  tradeCode: 'KMT-9042800-NG',
  displayState: 'AWAITING_PAYMENT',
  attempt,
  inline: {
    key: 'pk_test_x',
    email: 'ada@example.com',
    amount: 45878000,
    currency: 'NGN',
    reference: attempt.reference,
    channels: ['card', 'ussd', 'bank_transfer'],
  },
};

const recording = (body: unknown) => {
  const calls: { url: string; method: string; headers: Headers; body: string | null }[] = [];
  const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return Promise.resolve(json(body));
  });
  return { calls, client: createApiClient({ baseUrl: 'https://api.test/v1', fetch }) };
};

describe('the funding endpoints (T-072)', () => {
  it('mirror the routes: consumer scope, and the two mutations keyed for retries', () => {
    expect(initiatePayment).toMatchObject({
      method: 'post',
      path: '/trades/:code/payment/initiate',
      scope: 'CONSUMER',
      retryable: true,
    });
    expect(confirmPayment).toMatchObject({
      method: 'post',
      path: '/trades/:code/payment/confirm',
      scope: 'CONSUMER',
      retryable: true,
    });
    expect(getPaymentStatus).toMatchObject({
      method: 'get',
      path: '/trades/:code/payment/status',
      scope: 'CONSUMER',
    });
  });

  it('starts a payment by trade id with an idempotency key, and only sends restart when asked', async () => {
    const { calls, client } = recording(initiated);
    const answer = await client.call(initiatePayment, { params: { code: id(1) }, body: {} });
    await client.call(initiatePayment, { params: { code: id(1) }, body: { restart: true } });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `https://api.test/v1/trades/${id(1)}/payment/initiate`,
    });
    expect(calls[0]?.headers.get('idempotency-key')).toBeTruthy();
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({});
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({ restart: true });
    // Money stays kobo strings, except the one number Paystack Inline takes, passed through untouched.
    expect(answer.attempt.amountMinor).toBe('45878000');
    expect(answer.inline.amount).toBe(45878000);
  });

  it('confirms and reads status on the same trade', async () => {
    const status = { tradeId: id(1), tradeCode: 'KMT-9042800-NG', displayState: 'VERIFYING', attempt };
    const { calls, client } = recording(status);
    await client.call(confirmPayment, { params: { code: id(1) } });
    await client.call(getPaymentStatus, { params: { code: id(1) } });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST https://api.test/v1/trades/${id(1)}/payment/confirm`,
      `GET https://api.test/v1/trades/${id(1)}/payment/status`,
    ]);
    expect(calls[0]?.headers.get('idempotency-key')).toBeTruthy();
  });

  it('reads every display state the platform can send, and no other', () => {
    for (const displayState of [
      'NONE',
      'AWAITING_PAYMENT',
      'VERIFYING',
      'CONFIRMED',
      'NOT_CONFIRMED',
      'UNDER_REVIEW',
    ]) {
      expect(
        paymentStatusSchema.parse({
          tradeId: id(1),
          tradeCode: 'KMT-9042800-NG',
          displayState,
          attempt: null,
        }).displayState,
      ).toBe(displayState);
    }
    expect(() =>
      paymentStatusSchema.parse({ tradeId: id(1), tradeCode: 'X', displayState: 'PAID', attempt: null }),
    ).toThrow();
  });

  it('refuses money that is not a digit string of kobo', () => {
    expect(() =>
      initiatedPaymentSchema.parse({ ...initiated, attempt: { ...attempt, amountMinor: 458780 } }),
    ).toThrow();
    expect(() =>
      initiatedPaymentSchema.parse({ ...initiated, attempt: { ...attempt, amountMinor: '4587.80' } }),
    ).toThrow();
  });
});
