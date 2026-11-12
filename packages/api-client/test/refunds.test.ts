import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client.js';
import {
  approveCancellation,
  cancelAsSeller,
  cancellationSchema,
  declineCancellation,
  getCancellation,
  isRefundInFlight,
  listMyRefunds,
  listTradeRefunds,
  refundSchema,
  requestCancellation,
} from '../src/refunds.js';

const id = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const request = {
  id: id(3),
  requestedByRole: 'BUYER',
  reason: 'CHANGED_MIND',
  note: null,
  status: 'PENDING',
  responseNote: null,
  respondedAt: null,
  createdAt: '2026-11-11T09:00:00.000Z',
};
const refund = {
  id: id(9),
  tradeId: id(1),
  reference: `refund-${id(9)}`,
  status: 'PROCESSING' as const,
  scope: 'FULL',
  reason: 'MUTUAL_AGREEMENT',
  currency: 'NGN',
  itemAmountMinor: '45000000',
  feeAmountMinor: '675000',
  amountMinor: '45675000',
  buyerProtectionFeeTreatment: 'REFUND',
  failureReason: null,
  requestedAt: '2026-11-11T09:00:00.000Z',
  completedAt: null,
  failedAt: null,
};

const recording = (body: unknown, status = 200) => {
  const calls: { url: string; method: string; headers: Headers; body: string | null }[] = [];
  const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return Promise.resolve(json(body, status));
  });
  return { calls, client: createApiClient({ baseUrl: 'https://api.test/v1', fetch }) };
};

describe('the cancellation and refund endpoints (T-066, T-075)', () => {
  it('mirror the routes: consumer scope, and every action keyed for retries', () => {
    const table = [
      [getCancellation, 'get', '/trades/:id/cancellation'],
      [requestCancellation, 'post', '/trades/:id/cancellation-request'],
      [approveCancellation, 'post', '/trades/:id/cancellation-request/:requestId/approve'],
      [declineCancellation, 'post', '/trades/:id/cancellation-request/:requestId/decline'],
      [cancelAsSeller, 'post', '/trades/:id/cannot-fulfil'],
      [listTradeRefunds, 'get', '/trades/:id/refunds'],
      [listMyRefunds, 'get', '/me/refunds'],
    ] as const;
    for (const [endpoint, method, path] of table) {
      expect(endpoint, path).toMatchObject({ method, path, scope: 'CONSUMER' });
    }
    for (const endpoint of [requestCancellation, approveCancellation, declineCancellation, cancelAsSeller]) {
      expect(endpoint.retryable).toBe(true);
    }
    expect(listMyRefunds.paginated).toBe('cursor');
  });

  it('asks to cancel with a reason and an idempotency key, and never with an amount', async () => {
    const { calls, client } = recording(request, 201);
    await client.call(requestCancellation, { params: { id: id(1) }, body: { reason: 'CHANGED_MIND' } });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `https://api.test/v1/trades/${id(1)}/cancellation-request`,
    });
    expect(calls[0]?.headers.get('idempotency-key')).toBeTruthy();
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ reason: 'CHANGED_MIND' });
  });

  it('approves by request id', async () => {
    const { calls, client } = recording({ ...request, status: 'APPROVED' });
    await client.call(approveCancellation, { params: { id: id(1), requestId: id(3) }, body: {} });
    expect(calls[0]?.url).toBe(`https://api.test/v1/trades/${id(1)}/cancellation-request/${id(3)}/approve`);
  });

  it('refuses the buyer’s reasons on the seller’s cancellation', () => {
    expect(() => cancelAsSeller.schema.body?.parse({ reason: 'CHANGED_MIND' })).toThrow();
    expect(cancelAsSeller.schema.body?.parse({ reason: 'OUT_OF_STOCK' })).toEqual({ reason: 'OUT_OF_STOCK' });
  });

  it('reads the cancellation and the refunds the ledger decided', async () => {
    expect(
      cancellationSchema.parse({
        tradeId: id(1),
        tradeStatus: 'FUNDED',
        yourRole: 'SELLER',
        request,
        refundRequested: false,
        actions: { canRequest: false, canRespond: true, canCancelAsSeller: true },
      }).actions.canRespond,
    ).toBe(true);
    const { calls, client } = recording({ refunds: [refund] });
    const answer = await client.call(listTradeRefunds, { params: { id: id(1) } });
    expect(answer.refunds[0]?.amountMinor).toBe('45675000');
    expect(calls[0]?.url).toBe(`https://api.test/v1/trades/${id(1)}/refunds`);
  });

  it('refuses a status or money it does not know, and says which refunds are on their way', () => {
    expect(() => refundSchema.parse({ ...refund, status: 'PAID' })).toThrow();
    expect(() => refundSchema.parse({ ...refund, amountMinor: 45675000 })).toThrow();
    expect(isRefundInFlight(refund)).toBe(true);
    expect(isRefundInFlight({ status: 'PROCESSED' })).toBe(false);
    expect(isRefundInFlight({ status: 'FAILED' })).toBe(false);
  });
});
