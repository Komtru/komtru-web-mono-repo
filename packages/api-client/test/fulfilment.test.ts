import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client.js';
import { getShipOptions, reportDelivered, shipOptionsSchema, shipSelfArranged } from '../src/fulfilment.js';

const id = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const options = {
  tradeId: id(1),
  tradeCode: 'KMT-9042800-NG',
  options: [
    {
      kind: 'PARK',
      label: 'Park Hub Transit',
      available: false,
      reason: { code: 'PARK_NOT_AVAILABLE_IN_CITY', message: "Park isn't available in Ikeja yet" },
    },
    {
      kind: 'SELF_ARRANGED',
      label: 'Arrange my own shipping',
      available: true,
      requiredFields: ['waybillNumber', 'receiptFileId', 'driverPhone', 'vehiclePlate'],
    },
  ],
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

describe('the ship step endpoints (T-064)', () => {
  it('mirror the routes: consumer scope, and shipping keyed for retries', () => {
    expect(getShipOptions).toMatchObject({
      method: 'get',
      path: '/trades/:id/ship-options',
      scope: 'CONSUMER',
    });
    expect(reportDelivered).toMatchObject({
      method: 'post',
      path: '/trades/:id/report-delivered',
      scope: 'CONSUMER',
      retryable: true,
    });
    expect(shipSelfArranged).toMatchObject({
      method: 'post',
      path: '/trades/:id/ship/self-arranged',
      scope: 'CONSUMER',
      retryable: true,
    });
  });

  it('reads the options as the platform computed them, Park reason and all', async () => {
    const { calls, client } = recording(options);
    const answer = await client.call(getShipOptions, { params: { id: id(1) } });
    expect(calls[0]?.url).toBe(`https://api.test/v1/trades/${id(1)}/ship-options`);
    expect(answer.options.map((option) => option.kind)).toEqual(['PARK', 'SELF_ARRANGED']);
    expect(shipOptionsSchema.parse(options).options[0]).toMatchObject({ available: false });
  });

  it('ships with the four pieces of evidence and an idempotency key', async () => {
    const trade = {
      id: id(1),
      tradeCode: 'KMT-9042800-NG',
      shareUrl: 'https://app.komtru.com/trades/KMT-9042800-NG',
      categoryCode: null,
      categoryName: null,
      standardVersion: null,
      standardVersionId: null,
      status: 'SHIPPED',
      statusRevision: 10,
      initiatorRole: 'BUYER',
      yourRole: 'SELLER',
      awaiting: null,
      terms: null,
      fees: null,
      proofMediaCount: 0,
      sentAt: null,
      acceptedAt: null,
      createdAt: '2026-11-09T09:00:00.000Z',
    };
    const { calls, client } = recording(trade);
    const shipped = await client.call(shipSelfArranged, {
      params: { id: id(1) },
      body: {
        waybillNumber: 'KT-883192',
        receiptFileId: id(5),
        driverPhone: '08012345678',
        vehiclePlate: 'LSR 123 AB',
      },
    });
    expect(shipped.status).toBe('SHIPPED');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `https://api.test/v1/trades/${id(1)}/ship/self-arranged`,
    });
    expect(calls[0]?.headers.get('idempotency-key')).toBeTruthy();
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      waybillNumber: 'KT-883192',
      receiptFileId: id(5),
      driverPhone: '08012345678',
      vehiclePlate: 'LSR 123 AB',
    });
  });
});
