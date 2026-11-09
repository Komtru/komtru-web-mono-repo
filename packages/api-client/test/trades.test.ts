import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client.js';
import { UploadError, finalizeUpload, requestUploadUrl, uploadFile } from '../src/files.js';
import { classifyParty, lookupParty } from '../src/parties.js';
import { listTradeStandards } from '../src/standards.js';
import {
  acceptTrade,
  cancelTrade,
  claimTrade,
  counterTrade,
  createTrade,
  declineTrade,
  getTrade,
  getTradeByCode,
  listTrades,
  previewTrade,
  sendTrade,
  tradeViewSchema,
} from '../src/trades.js';

const id = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const trade = {
  id: id(1),
  tradeCode: 'KMT-9042800-NG',
  shareUrl: 'https://app.komtru.com/trades/KMT-9042800-NG',
  categoryCode: 'electronics',
  categoryName: 'Electronics',
  standardVersion: 2,
  status: 'AWAITING_ACCEPTANCE',
  statusRevision: 2,
  initiatorRole: 'BUYER',
  yourRole: 'BUYER',
  awaiting: 'COUNTERPARTY',
  terms: null,
  fees: null,
  proofMediaCount: 0,
  sentAt: '2026-11-09T10:00:00.000Z',
  acceptedAt: null,
  createdAt: '2026-11-09T09:00:00.000Z',
  someFieldTheBackendAddsLater: true,
};

const recording = (respond: (url: string) => Response) => {
  const calls: { url: string; method: string; headers: Headers; body: string | null }[] = [];
  const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return Promise.resolve(respond(url));
  });
  return { calls, client: createApiClient({ baseUrl: 'https://api.test/v1', fetch }) };
};

describe('the trade endpoints', () => {
  it('are consumer-scoped, and every mutation that changes a trade is keyed for retries', () => {
    for (const endpoint of [
      previewTrade,
      createTrade,
      getTrade,
      sendTrade,
      counterTrade,
      acceptTrade,
      declineTrade,
      cancelTrade,
      claimTrade,
    ]) {
      expect(endpoint.scope).toBe('CONSUMER');
    }
    for (const endpoint of [createTrade, sendTrade, counterTrade, acceptTrade, declineTrade, cancelTrade]) {
      expect(endpoint).toMatchObject({ method: 'post', retryable: true });
    }
    expect(previewTrade.retryable).toBe(false);
  });

  it('keeps fields the backend adds, so a new field never makes a trade unreadable', () => {
    const parsed = tradeViewSchema.parse(trade);
    expect(parsed).toHaveProperty('someFieldTheBackendAddsLater', true);
  });

  it('puts the trade id in the path and sends an idempotency key on a send', async () => {
    const { calls, client } = recording(() => json(trade));
    await client.call(sendTrade, { params: { id: id(1) }, body: { username: 'ada' } });
    expect(calls[0]).toMatchObject({ method: 'POST', url: `https://api.test/v1/trades/${id(1)}/send` });
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ username: 'ada' });
    expect(calls[0]?.headers.get('idempotency-key')).toBeTruthy();
  });

  it('sends money as a digit string', async () => {
    const { calls, client } = recording(() => json(trade, 201));
    await client.call(createTrade, {
      body: {
        role: 'BUYER',
        categoryCode: 'electronics',
        itemAmountMinor: '45200000',
        itemSpec: { brand: 'Apple' },
        addressId: id(5),
      },
    });
    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({ itemAmountMinor: '45200000' });
  });

  it('reads the public standards with a page query', async () => {
    const { calls, client } = recording(() => json({ items: [], page: 1, limit: 100, total: 0 }));
    await client.call(listTradeStandards, { query: { page: 1, limit: 100 } });
    expect(calls[0]?.url).toBe('https://api.test/v1/config/trade-standards?page=1&limit=100');
  });
});

describe('classifyParty', () => {
  it.each([
    ['@ada', { channel: 'USERNAME', value: 'ada' }],
    ['ada_obi', { channel: 'USERNAME', value: 'ada_obi' }],
    ['Ada@Example.com', { channel: 'EMAIL', value: 'ada@example.com' }],
    ['0802 341 5567', { channel: 'PHONE', value: '08023415567' }],
    ['+234 802-341-5567', { channel: 'PHONE', value: '+2348023415567' }],
  ])('reads %s', (input, expected) => {
    expect(classifyParty(input)).toEqual(expected);
  });

  it.each(['', '  ', 'a', 'two words', '12'])('does not guess at %j', (input) => {
    expect(classifyParty(input)).toBeUndefined();
  });
});

describe('lookupParty', () => {
  it('looks a handle up by query and an email or phone by body, never in the query string', async () => {
    const miss = { found: false, canInvite: true, maskedHint: null };
    const { calls, client } = recording(() => json(miss));
    await lookupParty(client, { channel: 'USERNAME', value: 'ada' });
    await lookupParty(client, { channel: 'EMAIL', value: 'ada@example.com' });
    await lookupParty(client, { channel: 'PHONE', value: '08023415567' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://api.test/v1/parties/lookup?username=ada',
      'POST https://api.test/v1/parties/lookup',
      'POST https://api.test/v1/parties/lookup',
    ]);
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({ email: 'ada@example.com' });
    expect(JSON.parse(calls[2]?.body ?? '{}')).toEqual({ phone: '08023415567' });
  });
});

describe('uploadFile', () => {
  const ticket = {
    fileId: id(9),
    cloudName: 'komtru',
    uploadUrl: 'https://upload.test/v1/komtru/auto/upload',
    params: { signature: 'sig', timestamp: '1' },
    maxBytes: 1000,
    expiresAt: '2026-11-09T11:00:00.000Z',
  };
  const photo = (size: number) => new File([new Uint8Array(size)], 'photo.jpg', { type: 'image/jpeg' });

  it('asks for a ticket, sends the bytes to the provider and finalises', async () => {
    const { calls, client } = recording((url) =>
      url.endsWith('/files/upload-url')
        ? json(ticket, 201)
        : json({ fileId: id(9), uploadState: 'PENDING' }, 202),
    );
    const provider = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    const fileId = await uploadFile(client, photo(10), {
      category: 'OTHER',
      visibility: 'PRIVATE_CASE',
      fetchImpl: provider,
    });
    expect(fileId).toBe(id(9));
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      category: 'OTHER',
      visibility: 'PRIVATE_CASE',
      contentType: 'image/jpeg',
    });
    expect(provider).toHaveBeenCalledOnce();
    expect(calls[1]?.url).toBe(`https://api.test/v1/files/${id(9)}/finalize`);
    expect(requestUploadUrl.retryable).toBe(false);
    expect(finalizeUpload.method).toBe('post');
  });

  it('refuses a file over the ticket limit before sending a byte', async () => {
    const { client } = recording(() => json(ticket, 201));
    const provider = vi.fn();
    await expect(
      uploadFile(client, photo(2000), { category: 'OTHER', visibility: 'PRIVATE_CASE', fetchImpl: provider }),
    ).rejects.toMatchObject({ reason: 'TOO_LARGE' });
    expect(provider).not.toHaveBeenCalled();
  });

  it('tells a refusal from a dropped connection, and does not finalise either', async () => {
    const { calls, client } = recording(() => json(ticket, 201));
    const refused = vi.fn(() => Promise.resolve(new Response('no', { status: 400 })));
    await expect(
      uploadFile(client, photo(10), { category: 'OTHER', visibility: 'PRIVATE_CASE', fetchImpl: refused }),
    ).rejects.toMatchObject({ reason: 'REJECTED' });
    const dropped = vi.fn(() => Promise.reject(new TypeError('network')));
    await expect(
      uploadFile(client, photo(10), { category: 'OTHER', visibility: 'PRIVATE_CASE', fetchImpl: dropped }),
    ).rejects.toBeInstanceOf(UploadError);
    expect(calls.every((c) => !c.url.endsWith('/finalize'))).toBe(true);
  });
});

describe('the trade list and the lookup by code', () => {
  it('lists with the state and cursor passed through untouched', async () => {
    const { calls, client } = recording(() => json({ items: [], nextCursor: null }));
    await client.call(listTrades, { query: { state: 'OPEN', limit: 20, cursor: 'opaque+/cursor==' } });
    expect(calls[0]?.url).toBe(
      'https://api.test/v1/trades?state=OPEN&limit=20&cursor=opaque%2B%2Fcursor%3D%3D',
    );
    expect(listTrades).toMatchObject({ method: 'get', paginated: 'cursor' });
  });

  it('reads a list row with a null counterparty and null handle and avatar', async () => {
    const row = {
      id: id(1),
      tradeCode: 'KMT-9042800-NG',
      status: 'AWAITING_ACCEPTANCE',
      statusRevision: 2,
      yourRole: 'SELLER',
      initiatorRole: 'BUYER',
      awaiting: 'YOU',
      attention: 'RESPOND_TO_PROPOSAL',
      counterparty: { publicId: 'U-1', username: null, displayName: 'Amaka B.', avatarUrl: null },
      item: { title: 'iPhone 13', categoryCode: 'electronics', categoryName: 'Electronics' },
      currency: 'NGN',
      itemAmountMinor: '45200000',
      buyerTotalMinor: null,
      sentAt: null,
      createdAt: '2026-11-09T09:00:00.000Z',
      updatedAt: '2026-11-09T09:00:00.000Z',
    };
    const { client } = recording(() =>
      json({ items: [row, { ...row, id: id(2), counterparty: null }], nextCursor: 'c1' }),
    );
    const page = await client.call(listTrades, { query: {} });
    expect(page.items.map((item) => item.counterparty?.displayName ?? null)).toEqual(['Amaka B.', null]);
    expect(page.nextCursor).toBe('c1');
  });

  it('puts the canonical code in the path and reads a party and an invitee answer', async () => {
    const answer = (access: string) => ({
      access,
      trade: {
        id: id(1),
        tradeCode: 'KMT-9042800-NG',
        status: 'PENDING_COUNTERPARTY',
        statusRevision: 1,
        yourRole: 'SELLER',
        categoryCode: null,
        categoryName: null,
        standardVersion: null,
      },
      counterparty: null,
    });
    const { calls, client } = recording(() => json(answer('INVITEE')));
    const result = await client.call(getTradeByCode, { params: { code: 'KMT-9042800-NG' } });
    expect(calls[0]?.url).toBe('https://api.test/v1/trades/by-code/KMT-9042800-NG');
    expect(result.access).toBe('INVITEE');
    expect(getTradeByCode.retryable).toBeUndefined();
  });
});
