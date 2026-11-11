// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/client.js';
import { ApiClientProvider } from '../../src/react/client-context.js';
import {
  tradeKeys,
  useAcceptInspection,
  useConfirmDelivery,
  useFileUrl,
  useRespondToInspectionExtension,
} from '../../src/react/trades.js';

const ID = '0190b0a0-0000-7000-8000-000000000001';
const REQ = '0190b0a0-0000-7000-8000-000000000009';
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const trade = (status: string) => ({
  id: ID,
  tradeCode: 'KMT-9042800-NG',
  shareUrl: 'https://app.komtru.com/trades/KMT-9042800-NG',
  categoryCode: null,
  categoryName: null,
  standardVersion: null,
  standardVersionId: null,
  status,
  statusRevision: 11,
  initiatorRole: 'BUYER',
  yourRole: 'BUYER',
  awaiting: null,
  terms: null,
  fees: null,
  proofMediaCount: 0,
  sentAt: null,
  acceptedAt: null,
  createdAt: '2026-11-09T09:00:00.000Z',
});

afterEach(cleanup);

function setup(respond: (method: string, path: string, body: string | null) => unknown) {
  const requests: { method: string; path: string; body: string | null }[] = [];
  const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const entry = {
      method: init?.method ?? 'GET',
      path: url.replace('https://api.test/v1', ''),
      body: typeof init?.body === 'string' ? init.body : null,
    };
    requests.push(entry);
    return Promise.resolve(json(respond(entry.method, entry.path, entry.body)));
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = createApiClient({ baseUrl: 'https://api.test/v1', fetch });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  return { requests, queryClient, wrapper };
}

describe('the delivery and inspection hooks', () => {
  it('confirming delivery writes the trade it answers with into the cache', async () => {
    const { requests, queryClient, wrapper } = setup(() => trade('INSPECTION'));
    const { result } = renderHook(() => useConfirmDelivery(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(ID);
    });
    expect(requests[0]).toMatchObject({ method: 'POST', path: `/trades/${ID}/confirm-delivery` });
    expect(queryClient.getQueryData<{ status: string }>(tradeKeys.one(ID))?.status).toBe('INSPECTION');
  });

  it('releasing sends the acknowledgement, and the cache shows the completed trade', async () => {
    const { requests, queryClient, wrapper } = setup(() => trade('COMPLETED'));
    const { result } = renderHook(() => useAcceptInspection(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(ID);
    });
    expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ acknowledged: true });
    expect(queryClient.getQueryData<{ status: string }>(tradeKeys.one(ID))?.status).toBe('COMPLETED');
  });

  it('answering a request for more time re-reads the inspection window', async () => {
    const { requests, queryClient, wrapper } = setup(() => ({ id: REQ, status: 'ACCEPTED' }));
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRespondToInspectionExtension(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: ID, requestId: REQ, decision: 'DECLINE' });
    });
    expect(requests[0]?.path).toBe(`/trades/${ID}/inspection-extension/${REQ}/decline`);
    expect(spy).toHaveBeenCalledWith({ queryKey: tradeKeys.inspection(ID) });
  });

  it('reads a file as a signed URL, and stays idle without an id', async () => {
    const { requests, wrapper } = setup(() => ({
      fileId: ID,
      url: 'https://files.test/a.jpg?sig=1',
      expiresAt: null,
      contentType: 'image/jpeg',
    }));
    const idle = renderHook(() => useFileUrl(undefined), { wrapper });
    expect(idle.result.current.fetchStatus).toBe('idle');
    const { result } = renderHook(() => useFileUrl(ID), { wrapper });
    await waitFor(() => {
      expect(result.current.data?.url).toBe('https://files.test/a.jpg?sig=1');
    });
    expect(requests[0]?.path).toBe(`/files/${ID}`);
  });
});
