// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/client.js';
import { ApiClientProvider } from '../../src/react/client-context.js';
import {
  PAYMENT_POLL_MS,
  paymentKey,
  useConfirmPayment,
  useInitiatePayment,
  usePaymentStatus,
} from '../../src/react/payments.js';
import { tradeKeys } from '../../src/react/trades.js';

const ID = '0190b0a0-0000-7000-8000-000000000001';
const ATTEMPT = '0190b0a0-0000-7000-8000-000000000007';
const attempt = (displayState: string) => ({
  id: ATTEMPT,
  reference: `fund-${ATTEMPT}`,
  status: 'PENDING',
  displayState,
  currency: 'NGN',
  amountMinor: '45878000',
  itemAmountMinor: '45200000',
  buyerProtectionFeeMinor: '678000',
  initiatedAt: '2026-11-10T09:00:00.000Z',
  confirmedAt: null,
});
const status = (displayState: string) => ({
  tradeId: ID,
  tradeCode: 'KMT-9042800-NG',
  displayState,
  attempt: displayState === 'NONE' ? null : attempt(displayState),
});
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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

describe('the payment hooks', () => {
  it('keep the status under the trade, so invalidating the trade refetches it', () => {
    expect(paymentKey(ID).slice(0, 2)).toEqual(tradeKeys.one(ID));
  });

  it('poll while the platform is verifying, and stop once it has an answer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answer = 'VERIFYING';
    const { requests, wrapper: Wrapper } = setup(() => status(answer));
    function Probe() {
      const query = usePaymentStatus(ID);
      return <p>{query.data?.displayState ?? 'loading'}</p>;
    }
    render(<Probe />, { wrapper: Wrapper });
    expect(await screen.findByText('VERIFYING')).toBeTruthy();
    answer = 'CONFIRMED';
    await vi.advanceTimersByTimeAsync(PAYMENT_POLL_MS + 10);
    expect(await screen.findByText('CONFIRMED')).toBeTruthy();
    const seen = requests.length;
    await vi.advanceTimersByTimeAsync(PAYMENT_POLL_MS * 3);
    expect(requests).toHaveLength(seen);
  });

  it('write what initiate and confirm answer into the status, and refresh the trade on confirm', async () => {
    const {
      requests,
      queryClient,
      wrapper: Wrapper,
    } = setup((url) =>
      url.endsWith('/initiate')
        ? {
            ...status('AWAITING_PAYMENT'),
            inline: {
              key: 'pk_test_x',
              email: 'ada@example.com',
              amount: 45878000,
              currency: 'NGN',
              reference: `fund-${ATTEMPT}`,
              channels: ['bank_transfer'],
            },
          }
        : url.endsWith('/confirm')
          ? status('VERIFYING')
          : status('NONE'),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    function Probe() {
      const query = usePaymentStatus(ID);
      const initiate = useInitiatePayment(ID);
      const confirm = useConfirmPayment(ID);
      return (
        <>
          <p>{query.data?.displayState ?? 'loading'}</p>
          <button type="button" onClick={() => initiate.mutate({})}>
            initiate
          </button>
          <button type="button" onClick={() => confirm.mutate()}>
            confirm
          </button>
        </>
      );
    }
    render(<Probe />, { wrapper: Wrapper });
    expect(await screen.findByText('NONE')).toBeTruthy();
    screen.getByRole('button', { name: 'initiate' }).click();
    expect(await screen.findByText('AWAITING_PAYMENT')).toBeTruthy();
    screen.getByRole('button', { name: 'confirm' }).click();
    expect(await screen.findByText('VERIFYING')).toBeTruthy();
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: tradeKeys.one(ID), exact: true });
    });
    expect(requests.slice(0, 3)).toEqual([
      `GET /trades/${ID}/payment/status`,
      `POST /trades/${ID}/payment/initiate`,
      `POST /trades/${ID}/payment/confirm`,
    ]);
  });
});
