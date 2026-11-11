// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/client.js';
import { ApiClientProvider } from '../../src/react/client-context.js';
import {
  tradeKeys,
  useReportDelivered,
  useShipOptions,
  useShipSelfArranged,
} from '../../src/react/trades.js';

const ID = '0190b0a0-0000-7000-8000-000000000001';
const FILE = '0190b0a0-0000-7000-8000-000000000005';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const shipped = {
  id: ID,
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

afterEach(cleanup);

function setup(respond: (url: string) => Response) {
  const requests: string[] = [];
  const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(`${init?.method ?? 'GET'} ${url.replace('https://api.test/v1', '')}`);
    return Promise.resolve(respond(url));
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 3 } } });
  const client = createApiClient({ baseUrl: 'https://api.test/v1', fetch });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  return { requests, queryClient, wrapper };
}

describe('the ship step hooks', () => {
  it('surface the dispatch guard 409 as an error and add no query-level retry', async () => {
    const { requests, wrapper: Wrapper } = setup(() =>
      json({ type: 'about:blank', title: 'Dispatch locked', status: 409, code: 'DISPATCH_LOCKED' }, 409),
    );
    function Probe() {
      const query = useShipOptions(ID);
      return <p>{query.isError ? 'locked' : 'loading'}</p>;
    }
    render(<Probe />, { wrapper: Wrapper });
    expect(await screen.findByText('locked')).toBeTruthy();
    // The client itself repeats an idempotent call that met a 409 (three tries in all); the hook adds none.
    expect(requests.length).toBeLessThanOrEqual(3);
  });

  it('write the trade the platform answers with into the trade cache', async () => {
    const { requests, queryClient, wrapper: Wrapper } = setup(() => json(shipped));
    function Probe() {
      const ship = useShipSelfArranged();
      return (
        <button
          type="button"
          onClick={() => {
            ship.mutate({
              id: ID,
              waybillNumber: 'KT-883192',
              receiptFileId: FILE,
              driverPhone: '08012345678',
              vehiclePlate: 'LSR 123 AB',
            });
          }}
        >
          ship
        </button>
      );
    }
    render(<Probe />, { wrapper: Wrapper });
    screen.getByText('ship').click();
    await waitFor(() => {
      expect(queryClient.getQueryData<{ status: string }>(tradeKeys.one(ID))?.status).toBe('SHIPPED');
    });
    expect(requests).toEqual([`POST /trades/${ID}/ship/self-arranged`]);
  });

  it('drop the ship options and refresh the activity once shipped', async () => {
    const { queryClient, wrapper: Wrapper } = setup(() => json(shipped));
    queryClient.setQueryData(tradeKeys.shipOptions(ID), { options: [] });
    queryClient.setQueryData(tradeKeys.activity(ID), { pages: [] });
    function Probe() {
      const ship = useShipSelfArranged();
      return (
        <button
          type="button"
          onClick={() => {
            ship.mutate({
              id: ID,
              waybillNumber: 'KT-883192',
              receiptFileId: FILE,
              driverPhone: '08012345678',
              vehiclePlate: 'LSR 123 AB',
            });
          }}
        >
          ship
        </button>
      );
    }
    render(<Probe />, { wrapper: Wrapper });
    screen.getByText('ship').click();
    await waitFor(() => {
      expect(queryClient.getQueryData(tradeKeys.shipOptions(ID))).toBeUndefined();
    });
    expect(queryClient.getQueryState(tradeKeys.activity(ID))?.isInvalidated).toBe(true);
  });

  it('report delivery writes the trade it answers with into the cache', async () => {
    const {
      requests,
      queryClient,
      wrapper: Wrapper,
    } = setup(() => json({ ...shipped, status: 'UNCONFIRMED_DELIVERY' }));
    function Probe() {
      const report = useReportDelivered();
      return (
        <button
          type="button"
          onClick={() => {
            report.mutate(ID);
          }}
        >
          report
        </button>
      );
    }
    render(<Probe />, { wrapper: Wrapper });
    screen.getByText('report').click();
    await waitFor(() => {
      expect(queryClient.getQueryData<{ status: string }>(tradeKeys.one(ID))?.status).toBe(
        'UNCONFIRMED_DELIVERY',
      );
    });
    expect(requests).toEqual([`POST /trades/${ID}/report-delivered`]);
  });
});
