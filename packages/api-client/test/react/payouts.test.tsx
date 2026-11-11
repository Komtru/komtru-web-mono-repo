// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/client.js';
import { ApiClientProvider } from '../../src/react/client-context.js';
import {
  PAYOUT_POLL_MS,
  usePayoutSummary,
  payoutKeys,
  useAddPayoutAccount,
  usePayout,
  usePayoutAccounts,
  usePayouts,
  useRemovePayoutAccount,
  useRequestPayout,
  useSetDefaultPayoutAccount,
  useSetPayoutPreference,
} from '../../src/react/payouts.js';

const PAYOUT = '0190b0a0-0000-7000-8000-000000000011';
const ACCOUNT = '0190b0a0-0000-7000-8000-000000000021';
const KEY = '0190b0a0-0000-7000-8000-0000000000aa';

const destination = {
  id: ACCOUNT,
  bankCode: '058',
  bankName: 'GTBank',
  accountNumberMasked: '******5567',
  accountName: 'ADA OBI',
};
const payout = (status: string) => ({
  id: PAYOUT,
  reference: `payout-${PAYOUT}`,
  status,
  trigger: 'MANUAL',
  currency: 'NGN',
  amountMinor: '120000000',
  feeMinor: '0',
  transferAmountMinor: '120000000',
  destination,
  sourceTradeId: null,
  failureReason: null,
  requestedAt: '2026-11-11T09:00:00.000Z',
  dispatchedAt: null,
  completedAt: null,
  failedAt: null,
});
const account = (status: string, isDefault = false) => ({
  ...destination,
  accountName: status === 'VERIFIED' ? 'ADA OBI' : null,
  status,
  isDefault,
  failureReason: null,
  createdAt: '2026-11-11T08:00:00.000Z',
  verifiedAt: null,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

interface Seen {
  line: string;
  body: unknown;
  headers: Record<string, string>;
}

function setup(respond: (path: string, method: string) => unknown) {
  const requests: Seen[] = [];
  const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace('https://api.test/v1', '');
    const method = init?.method ?? 'GET';
    requests.push({
      line: `${method} ${path}`,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return Promise.resolve(json(respond(path, method)));
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

describe('the payout hooks', () => {
  it('keep everything about payouts under one key, so one invalidation refreshes the money screens', () => {
    for (const key of [payoutKeys.summary, payoutKeys.list, payoutKeys.one(PAYOUT), payoutKeys.accounts]) {
      expect(key.slice(0, 2)).toEqual(payoutKeys.all);
    }
  });

  it('poll a payout while it is on its way and stop once the platform has settled it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let status = 'PROCESSING';
    const { requests, wrapper: Wrapper } = setup(() => payout(status));
    function Probe() {
      return <p>{usePayout(PAYOUT).data?.status ?? 'loading'}</p>;
    }
    render(<Probe />, { wrapper: Wrapper });
    expect(await screen.findByText('PROCESSING')).toBeTruthy();
    status = 'SUCCEEDED';
    await vi.advanceTimersByTimeAsync(PAYOUT_POLL_MS + 10);
    expect(await screen.findByText('SUCCEEDED')).toBeTruthy();
    const seen = requests.length;
    await vi.advanceTimersByTimeAsync(PAYOUT_POLL_MS * 3);
    expect(requests).toHaveLength(seen);
  });

  it('poll the accounts while one is still being checked with the bank', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let status = 'PENDING_VERIFICATION';
    const { requests, wrapper: Wrapper } = setup(() => ({ accounts: [account(status)] }));
    function Probe() {
      return <p>{usePayoutAccounts().data?.[0]?.status ?? 'loading'}</p>;
    }
    render(<Probe />, { wrapper: Wrapper });
    expect(await screen.findByText('PENDING_VERIFICATION')).toBeTruthy();
    status = 'VERIFIED';
    await vi.advanceTimersByTimeAsync(PAYOUT_POLL_MS + 10);
    expect(await screen.findByText('VERIFIED')).toBeTruthy();
    const seen = requests.length;
    await vi.advanceTimersByTimeAsync(PAYOUT_POLL_MS * 3);
    expect(requests).toHaveLength(seen);
  });

  it('read the history newest first, a page at a time', async () => {
    const { requests, wrapper: Wrapper } = setup((path) =>
      path.includes('cursor=')
        ? { items: [payout('FAILED')], nextCursor: null }
        : { items: [payout('SUCCEEDED')], nextCursor: 'c2' },
    );
    function Probe() {
      const list = usePayouts();
      const items = (list.data?.pages ?? []).flatMap((page) => page.items);
      return (
        <>
          <p>{items.map((item) => item.status).join(',') || 'loading'}</p>
          <button type="button" onClick={() => void list.fetchNextPage()}>
            more
          </button>
        </>
      );
    }
    render(<Probe />, { wrapper: Wrapper });
    expect(await screen.findByText('SUCCEEDED')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    expect(await screen.findByText('SUCCEEDED,FAILED')).toBeTruthy();
    expect(requests.map((r) => r.line)).toEqual([
      'GET /me/payouts?limit=20',
      'GET /me/payouts?limit=20&cursor=c2',
    ]);
  });

  it('send a withdrawal with the key the screen holds, store the payout and refresh the balance', async () => {
    const { requests, queryClient, wrapper: Wrapper } = setup(() => payout('REQUESTED'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    function Probe() {
      const withdraw = useRequestPayout();
      return (
        <button
          type="button"
          onClick={() =>
            withdraw.mutate({
              body: { amountMinor: '120000000', payoutAccountId: ACCOUNT },
              idempotencyKey: KEY,
            })
          }
        >
          withdraw
        </button>
      );
    }
    render(<Probe />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'withdraw' }));
    await waitFor(() => expect(queryClient.getQueryData(payoutKeys.one(PAYOUT))).toBeTruthy());
    expect(requests[0]?.line).toBe('POST /me/payouts');
    expect(requests[0]?.body).toEqual({ amountMinor: '120000000', payoutAccountId: ACCOUNT });
    expect(requests[0]?.headers['idempotency-key']).toBe(KEY);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: payoutKeys.summary });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: payoutKeys.list });
  });

  it('refresh the accounts, the summary and the preference after any account change', async () => {
    const {
      requests,
      queryClient,
      wrapper: Wrapper,
    } = setup((_path, method) =>
      method === 'DELETE' ? account('DISABLED') : account('PENDING_VERIFICATION'),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    function Probe() {
      const add = useAddPayoutAccount();
      const makeDefault = useSetDefaultPayoutAccount();
      const remove = useRemovePayoutAccount();
      return (
        <>
          <button type="button" onClick={() => add.mutate({ bankCode: '058', accountNumber: '0123455567' })}>
            add
          </button>
          <button type="button" onClick={() => makeDefault.mutate(ACCOUNT)}>
            default
          </button>
          <button type="button" onClick={() => remove.mutate(ACCOUNT)}>
            remove
          </button>
        </>
      );
    }
    render(<Probe />, { wrapper: Wrapper });
    for (const name of ['add', 'default', 'remove']) {
      fireEvent.click(screen.getByRole('button', { name }));
    }
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests.map((r) => r.line)).toEqual([
      'POST /me/payout-accounts',
      `POST /me/payout-accounts/${ACCOUNT}/default`,
      `DELETE /me/payout-accounts/${ACCOUNT}`,
    ]);
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: payoutKeys.accounts }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: payoutKeys.summary });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: payoutKeys.preference });
  });

  it('write the chosen mode into the preference and refresh the summary', async () => {
    const answer = { mode: 'AUTO_WEEKLY', defaultAccount: destination };
    const { requests, queryClient, wrapper: Wrapper } = setup(() => answer);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    function Probe() {
      const set = useSetPayoutPreference();
      return (
        <button type="button" onClick={() => set.mutate('AUTO_WEEKLY')}>
          weekly
        </button>
      );
    }
    render(<Probe />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'weekly' }));
    await waitFor(() => expect(queryClient.getQueryData(payoutKeys.preference)).toEqual(answer));
    expect(requests[0]?.line).toBe('PUT /me/payout-preferences');
    expect(requests[0]?.body).toEqual({ mode: 'AUTO_WEEKLY' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: payoutKeys.summary });
  });
});

describe('the bank list key', () => {
  it('sits outside the seller’s payout keys, so refreshing money never refetches reference data', () => {
    expect(payoutKeys.banks.slice(0, 2)).not.toEqual(payoutKeys.all);
  });
});

describe('the balance and history', () => {
  it('poll while money is on its way and stop once it has settled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let settled = false;
    const { requests, wrapper: Wrapper } = setup((path) =>
      path.startsWith('/me/payouts/summary')
        ? {
            currency: 'NGN',
            availableMinor: '0',
            inFlightMinor: settled ? '0' : '120000000',
            payoutFeeMinor: '0',
            mode: 'MANUAL',
            held: false,
            defaultAccount: destination,
          }
        : { items: [payout(settled ? 'SUCCEEDED' : 'PROCESSING')], nextCursor: null },
    );
    function Probe() {
      const summary = usePayoutSummary();
      const list = usePayouts();
      const status = list.data?.pages[0]?.items[0]?.status ?? 'loading';
      return <p>{`${summary.data?.inFlightMinor ?? 'loading'} ${status}`}</p>;
    }
    render(<Probe />, { wrapper: Wrapper });
    expect(await screen.findByText('120000000 PROCESSING')).toBeTruthy();
    settled = true;
    await vi.advanceTimersByTimeAsync(PAYOUT_POLL_MS + 10);
    expect(await screen.findByText('0 SUCCEEDED')).toBeTruthy();
    const seen = requests.length;
    await vi.advanceTimersByTimeAsync(PAYOUT_POLL_MS * 3);
    expect(requests).toHaveLength(seen);
  });
});
