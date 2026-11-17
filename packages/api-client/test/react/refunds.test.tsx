// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/client.js';
import { ApiClientProvider } from '../../src/react/client-context.js';
import {
  REFUND_POLL_MAX_MS,
  REFUND_POLL_MS,
  refundPollDelay,
  refundKeys,
  useCancelAsSeller,
  useMyRefunds,
  useTradeRefunds,
} from '../../src/react/refunds.js';
import { tradeKeys } from '../../src/react/trades.js';

const TRADE = '0190b0a0-0000-7000-8000-000000000001';
const REFUND = '0190b0a0-0000-7000-8000-000000000009';

const refund = (status: string) => ({
  id: REFUND,
  tradeId: TRADE,
  reference: `refund-${REFUND}`,
  status,
  scope: 'FULL',
  reason: 'SELLER_CANNOT_FULFIL',
  currency: 'NGN',
  itemAmountMinor: '45000000',
  feeAmountMinor: '675000',
  amountMinor: '45675000',
  buyerProtectionFeeTreatment: 'REFUND',
  failureReason: null,
  requestedAt: '2026-11-11T09:00:00.000Z',
  completedAt: status === 'PROCESSED' ? '2026-11-11T10:00:00.000Z' : null,
  failedAt: null,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(respond: (path: string, method: string) => unknown) {
  const requests: string[] = [];
  const bodies: unknown[] = [];
  const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body));
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace('https://api.test/v1', '');
    const method = init?.method ?? 'GET';
    requests.push(`${method} ${path}`);
    return Promise.resolve(json(respond(path, method)));
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = createApiClient({ baseUrl: 'https://api.test/v1', fetch });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  return { requests, bodies, queryClient, wrapper };
}

describe('refundPollDelay', () => {
  it('backs off from 5s to once a minute', () => {
    expect([1, 2, 3, 4, 5, 6].map(refundPollDelay)).toEqual([5000, 10000, 20000, 40000, 60000, 60000]);
  });

  it('gives up after about half an hour, so a refund stuck for days is not asked about for days', () => {
    expect(refundPollDelay(1)).toBe(REFUND_POLL_MS);
    expect(refundPollDelay(33)).toBe(REFUND_POLL_MAX_MS);
    expect(refundPollDelay(34)).toBe(false);
    expect(refundPollDelay(60)).toBe(false);
  });
});

describe('the refund hooks', () => {
  it('keep a trade’s cancellation and refunds under the trade, so one invalidation refreshes them', () => {
    for (const key of [refundKeys.cancellation(TRADE), refundKeys.forTrade(TRADE)]) {
      expect(key.slice(0, 2)).toEqual(tradeKeys.one(TRADE));
    }
  });

  it('poll the buyer’s own refund list while one is on its way back, and stop once it is settled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let status = 'PROCESSING';
    const { requests, wrapper: Wrapper } = setup(() => ({ items: [refund(status)], nextCursor: null }));
    function Probe() {
      const list = useMyRefunds();
      return <p>{list.data?.pages[0]?.items[0]?.status ?? 'loading'}</p>;
    }
    render(<Probe />, { wrapper: Wrapper });
    expect(await screen.findByText('PROCESSING')).toBeTruthy();
    status = 'PROCESSED';
    await vi.advanceTimersByTimeAsync(REFUND_POLL_MS + 10);
    expect(await screen.findByText('PROCESSED')).toBeTruthy();
    const seen = requests.length;
    await vi.advanceTimersByTimeAsync(REFUND_POLL_MS * 3);
    expect(requests).toHaveLength(seen);
  });

  it('poll a refund on its way back and stop once the platform has settled it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let status = 'PROCESSING';
    const { requests, wrapper: Wrapper } = setup(() => ({ refunds: [refund(status)] }));
    function Probe() {
      return <p>{useTradeRefunds(TRADE).data?.refunds[0]?.status ?? 'loading'}</p>;
    }
    render(<Probe />, { wrapper: Wrapper });
    expect(await screen.findByText('PROCESSING')).toBeTruthy();
    status = 'PROCESSED';
    await vi.advanceTimersByTimeAsync(REFUND_POLL_MS + 10);
    expect(await screen.findByText('PROCESSED')).toBeTruthy();
    const seen = requests.length;
    await vi.advanceTimersByTimeAsync(REFUND_POLL_MS * 3);
    expect(requests).toHaveLength(seen);
  });

  it('refreshes everything about the trade once the seller cancels', async () => {
    const { queryClient, wrapper: Wrapper } = setup(() => ({
      id: '0190b0a0-0000-7000-8000-000000000003',
      requestedByRole: 'SELLER',
      reason: 'OUT_OF_STOCK',
      note: null,
      status: 'APPROVED',
      responseNote: null,
      respondedAt: '2026-11-11T09:00:00.000Z',
      createdAt: '2026-11-11T09:00:00.000Z',
    }));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    let mutate: ReturnType<typeof useCancelAsSeller>['mutate'] | undefined;
    function Probe() {
      const mutation = useCancelAsSeller();
      mutate = mutation.mutate;
      return <p>{mutation.data?.status ?? 'idle'}</p>;
    }
    render(<Probe />, { wrapper: Wrapper });
    mutate?.({ tradeId: TRADE, reason: 'OUT_OF_STOCK' });
    expect(await screen.findByText('APPROVED')).toBeTruthy();
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: tradeKeys.one(TRADE) });
    });
  });

  it('sends a note trimmed, and none at all when only spaces were typed', async () => {
    const answered = {
      id: '0190b0a0-0000-7000-8000-000000000003',
      requestedByRole: 'SELLER',
      reason: 'OUT_OF_STOCK',
      note: null,
      status: 'APPROVED',
      responseNote: null,
      respondedAt: '2026-11-11T09:00:00.000Z',
      createdAt: '2026-11-11T09:00:00.000Z',
    };
    const { bodies, wrapper: Wrapper } = setup(() => answered);
    let mutateAsync: ReturnType<typeof useCancelAsSeller>['mutateAsync'] | undefined;
    function Probe() {
      mutateAsync = useCancelAsSeller().mutateAsync;
      return null;
    }
    render(<Probe />, { wrapper: Wrapper });
    await mutateAsync?.({ tradeId: TRADE, reason: 'OUT_OF_STOCK', note: '  sold out  ' });
    await mutateAsync?.({ tradeId: TRADE, reason: 'OUT_OF_STOCK', note: '   ' });
    expect(bodies).toEqual([{ reason: 'OUT_OF_STOCK', note: 'sold out' }, { reason: 'OUT_OF_STOCK' }]);
  });
});
