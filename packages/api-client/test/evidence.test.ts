import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client.js';
import { attachEvidence, EVIDENCE_EVENTS, evidenceEventsFor, listTradeEvidence } from '../src/evidence.js';

const id = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const item = {
  id: id(9),
  fileId: id(5),
  event: 'DELIVERY',
  attachedByRole: 'BUYER',
  attachedAt: '2026-11-17T09:00:00.000Z',
};

const recording = (body: unknown, status = 200) => {
  const calls: { url: string; method: string; body: string | null }[] = [];
  const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    );
  });
  return { calls, client: createApiClient({ baseUrl: 'https://api.test/v1', fetch }) };
};

describe('the evidence endpoints (F-028)', () => {
  it('mirror the routes: consumer scope, attach keyed for retries, list paginated', () => {
    expect(attachEvidence).toMatchObject({
      method: 'post',
      path: '/trades/:id/evidence',
      scope: 'CONSUMER',
      retryable: true,
    });
    expect(listTradeEvidence).toMatchObject({
      method: 'get',
      path: '/trades/:id/evidence',
      scope: 'CONSUMER',
      paginated: 'cursor',
    });
  });

  it('offer each side only the events the platform lets them add', () => {
    expect(EVIDENCE_EVENTS).toEqual(['DISPATCH', 'DELIVERY', 'INSPECTION', 'ISSUE']);
    expect(evidenceEventsFor('BUYER')).toEqual(['DELIVERY', 'INSPECTION', 'ISSUE']);
    expect(evidenceEventsFor('SELLER')).toEqual(['DISPATCH', 'DELIVERY', 'ISSUE']);
  });

  it('attach sends the event and the file ids, and reads back what was stored', async () => {
    const { calls, client } = recording({ evidence: [item] }, 201);
    const answer = await client.call(attachEvidence, {
      params: { id: id(1) },
      body: { event: 'DELIVERY', fileIds: [id(5)] },
    });
    expect(calls[0]).toMatchObject({ method: 'POST', url: `https://api.test/v1/trades/${id(1)}/evidence` });
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ event: 'DELIVERY', fileIds: [id(5)] });
    expect(answer.evidence[0]).toMatchObject({ fileId: id(5), attachedByRole: 'BUYER' });
  });

  it('list asks for one event and reads a page', async () => {
    const { calls, client } = recording({ items: [item], nextCursor: null });
    const page = await client.call(listTradeEvidence, {
      params: { id: id(1) },
      query: { event: 'DELIVERY', limit: 40 },
    });
    expect(calls[0]?.url).toBe(`https://api.test/v1/trades/${id(1)}/evidence?event=DELIVERY&limit=40`);
    expect(page.items).toHaveLength(1);
  });
});
