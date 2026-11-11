import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client.js';
import {
  addPayoutAccount,
  getPayout,
  getPayoutPreference,
  getPayoutSummary,
  listBanks,
  listPayoutAccounts,
  listPayouts,
  payoutSchema,
  removePayoutAccount,
  requestPayout,
  setDefaultPayoutAccount,
  setPayoutPreference,
} from '../src/payouts.js';

const id = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const destination = {
  id: id(2),
  bankCode: '058',
  bankName: 'Guaranty Trust Bank',
  accountNumberMasked: '******5567',
  accountName: 'ADA OKAFOR',
};
const payout = {
  id: id(7),
  reference: `payout-${id(7)}`,
  status: 'REQUESTED',
  trigger: 'MANUAL',
  currency: 'NGN',
  amountMinor: '5000000',
  feeMinor: '0',
  transferAmountMinor: '5000000',
  destination,
  sourceTradeId: null,
  failureReason: null,
  requestedAt: '2026-11-11T09:00:00.000Z',
  dispatchedAt: null,
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

describe('the payout endpoints (T-073)', () => {
  it('mirror the routes: consumer scope, and only the withdrawal keyed for retries', () => {
    const table = [
      [listBanks, 'get', '/payouts/banks'],
      [listPayoutAccounts, 'get', '/me/payout-accounts'],
      [addPayoutAccount, 'post', '/me/payout-accounts'],
      [setDefaultPayoutAccount, 'post', '/me/payout-accounts/:id/default'],
      [removePayoutAccount, 'delete', '/me/payout-accounts/:id'],
      [getPayoutPreference, 'get', '/me/payout-preferences'],
      [setPayoutPreference, 'put', '/me/payout-preferences'],
      [getPayoutSummary, 'get', '/me/payouts/summary'],
      [listPayouts, 'get', '/me/payouts'],
      [getPayout, 'get', '/me/payouts/:id'],
      [requestPayout, 'post', '/me/payouts'],
    ] as const;
    for (const [endpoint, method, path] of table) {
      expect(endpoint, path).toMatchObject({ method, path, scope: 'CONSUMER' });
    }
    expect(requestPayout.retryable).toBe(true);
    expect(addPayoutAccount.retryable).toBe(false);
    expect(listPayouts.paginated).toBe('cursor');
  });

  it('withdraws with an idempotency key and kobo as a digit string', async () => {
    const { calls, client } = recording(payout, 201);
    const answer = await client.call(requestPayout, { body: { amountMinor: '5000000' } });
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://api.test/v1/me/payouts' });
    expect(calls[0]?.headers.get('idempotency-key')).toBeTruthy();
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ amountMinor: '5000000' });
    expect(answer.transferAmountMinor).toBe('5000000');
  });

  it('pages the history by cursor and reads one receipt by id', async () => {
    const { calls, client } = recording({ items: [payout], nextCursor: null });
    const page = await client.call(listPayouts, { query: { limit: 20, cursor: 'abc' } });
    expect(page.items[0]?.reference).toBe(payout.reference);
    expect(calls[0]?.url).toBe('https://api.test/v1/me/payouts?limit=20&cursor=abc');

    const one = recording(payout);
    await one.client.call(getPayout, { params: { id: id(7) } });
    expect(one.calls[0]?.url).toBe(`https://api.test/v1/me/payouts/${id(7)}`);
  });

  it('removes an account with DELETE', async () => {
    const { calls, client } = recording({
      ...destination,
      status: 'DISABLED',
      isDefault: false,
      failureReason: null,
      createdAt: '2026-11-11T09:00:00.000Z',
      verifiedAt: '2026-11-11T09:01:00.000Z',
    });
    await client.call(removePayoutAccount, { params: { id: id(2) } });
    expect(calls[0]).toMatchObject({
      method: 'DELETE',
      url: `https://api.test/v1/me/payout-accounts/${id(2)}`,
    });
  });

  it('refuses a status or money it does not know', () => {
    expect(() => payoutSchema.parse({ ...payout, status: 'PAID' })).toThrow();
    expect(() => payoutSchema.parse({ ...payout, amountMinor: 5000000 })).toThrow();
    expect(payoutSchema.parse({ ...payout, status: 'NEEDS_REVIEW' }).status).toBe('NEEDS_REVIEW');
  });
});
