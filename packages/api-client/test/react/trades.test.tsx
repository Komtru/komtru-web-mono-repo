// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/client.js';
import { ApiClientProvider } from '../../src/react/client-context.js';
import {
  tradeKeys,
  useDeclineTrade,
  useTrade,
  useTradeList,
  useTradeStandards,
} from '../../src/react/trades.js';

const ID = '0190b0a0-0000-7000-8000-000000000001';
const trade = (status: string) => ({
  id: ID,
  tradeCode: 'KMT-9042800-NG',
  shareUrl: 'https://app.komtru.com/trades/KMT-9042800-NG',
  categoryCode: null,
  categoryName: null,
  standardVersion: null,
  status,
  statusRevision: 3,
  initiatorRole: 'SELLER',
  yourRole: 'BUYER',
  awaiting: null,
  terms: null,
  fees: null,
  proofMediaCount: 0,
  sentAt: null,
  acceptedAt: null,
  createdAt: '2026-11-09T09:00:00.000Z',
});
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(cleanup);

function setup(respond: (url: string, method: string) => unknown) {
  const requests: string[] = [];
  const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(`${init?.method ?? 'GET'} ${url.replace('https://api.test/v1', '')}`);
    return Promise.resolve(json(respond(url, init?.method ?? 'GET')));
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

describe('the trade hooks', () => {
  it('reads one trade, and a decline writes the answer into the same cache entry', async () => {
    const {
      requests,
      queryClient,
      wrapper: Wrapper,
    } = setup((url, method) =>
      method === 'POST' && url.endsWith('/decline') ? trade('DECLINED') : trade('AWAITING_ACCEPTANCE'),
    );
    function Probe() {
      const query = useTrade(ID);
      const decline = useDeclineTrade();
      return (
        <>
          <p>{query.data?.status ?? 'loading'}</p>
          <button
            type="button"
            onClick={() => {
              decline.mutate({ id: ID, reason: 'Price too high' });
            }}
          >
            decline
          </button>
        </>
      );
    }
    render(<Probe />, { wrapper: Wrapper });
    expect(await screen.findByText('AWAITING_ACCEPTANCE')).toBeTruthy();
    screen.getByRole('button', { name: 'decline' }).click();
    await waitFor(() => {
      expect(queryClient.getQueryData<{ status: string }>(tradeKeys.one(ID))?.status).toBe('DECLINED');
    });
    expect(requests).toEqual([`GET /trades/${ID}`, `POST /trades/${ID}/decline`]);
  });

  it('lists the standards from one page', async () => {
    const { wrapper: Wrapper } = setup(() => ({
      items: [
        {
          versionId: ID,
          categoryCode: 'electronics',
          categoryName: 'Electronics',
          versionNumber: 1,
          createdAt: '2026-11-01T00:00:00.000Z',
          inspectionWindowHours: 48,
          itemSpecFields: [{ key: 'brand', label: 'Brand', required: true }],
          proofMedia: { minPhotos: 3, requireVideo: false },
          imeiVerification: false,
          deliveryDeadlineDays: 7,
        },
      ],
      page: 1,
      limit: 100,
      total: 1,
    }));
    function Probe() {
      const { data } = useTradeStandards();
      return <p>{data?.map((s) => s.categoryName).join(',') ?? 'loading'}</p>;
    }
    render(<Probe />, { wrapper: Wrapper });
    expect(await screen.findByText('Electronics')).toBeTruthy();
  });
});

describe('useTradeList', () => {
  const row = (n: number) => ({
    id: `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`,
    tradeCode: 'KMT-9042800-NG',
    status: 'PENDING_PAYMENT',
    statusRevision: 1,
    yourRole: 'BUYER',
    initiatorRole: 'BUYER',
    awaiting: null,
    attention: 'PAY',
    counterparty: null,
    item: { title: null, categoryCode: null, categoryName: null },
    currency: 'NGN',
    itemAmountMinor: '100',
    buyerTotalMinor: '110',
    sentAt: null,
    createdAt: '2026-11-09T09:00:00.000Z',
    updatedAt: '2026-11-09T09:00:00.000Z',
  });

  it('sends the cursor back exactly as it came, page after page', async () => {
    const urls: string[] = [];
    const { wrapper: Wrapper } = setup((url) => {
      urls.push(url.replace('https://api.test/v1', ''));
      return url.includes('cursor=')
        ? { items: [row(2)], nextCursor: null }
        : { items: [row(1)], nextCursor: 'a b+c/d==' };
    });
    function Probe() {
      const list = useTradeList('OPEN');
      return (
        <>
          <p>{String(list.data?.pages.flatMap((page) => page.items).length ?? 0)}</p>
          <button type="button" onClick={() => void list.fetchNextPage()}>
            more
          </button>
        </>
      );
    }
    render(<Probe />, { wrapper: Wrapper });
    await screen.findByText('1');
    screen.getByRole('button', { name: 'more' }).click();
    await screen.findByText('2');
    expect(urls[0]).toBe('/trades?state=OPEN&limit=20');
    expect(urls[1]).toBe('/trades?state=OPEN&limit=20&cursor=a+b%2Bc%2Fd%3D%3D');
  });

  it('starts again from page one when a cursor is refused with 422, and never resends that cursor', async () => {
    const urls: string[] = [];
    let first = true;
    const requests: string[] = [];
    const fetch = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push(url);
      urls.push(url);
      if (url.includes('cursor=')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              type: 'about:blank',
              title: 'Invalid cursor',
              status: 422,
              code: 'VALIDATION_FAILED',
            }),
            {
              status: 422,
              headers: { 'content-type': 'application/problem+json' },
            },
          ),
        );
      }
      const body = first ? { items: [row(1)], nextCursor: 'stale' } : { items: [row(3)], nextCursor: null };
      first = false;
      return Promise.resolve(json(body));
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const client = createApiClient({ baseUrl: 'https://api.test/v1', fetch });
    function Probe() {
      const list = useTradeList('ALL');
      return (
        <>
          <p>
            {list.data?.pages.flatMap((page) => page.items.map((item) => item.id.slice(-2))).join(',') ??
              'none'}
          </p>
          <button type="button" onClick={() => void list.fetchNextPage()}>
            more
          </button>
        </>
      );
    }
    render(
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={client}>
          <Probe />
        </ApiClientProvider>
      </QueryClientProvider>,
    );
    await screen.findByText('01');
    screen.getByRole('button', { name: 'more' }).click();
    await screen.findByText('03');
    expect(requests.filter((url) => url.includes('cursor=stale'))).toHaveLength(1);
  });
});
