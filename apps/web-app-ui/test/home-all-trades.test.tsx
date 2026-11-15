// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiReact from '@komtru/api-client/react';
import { useAllTrades } from '../src/home/useAllTrades';
import { ProblemError } from '@komtru/api-client';
import { answerWith, callsTo, id, listItem, renderWithApi, type CallFn } from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
const live = vi.hoisted(() => ({ subscribe: vi.fn() }));

// The real subscription still runs; the spy records which rooms it was asked to join.
vi.mock('@komtru/api-client/react', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiReact>();
  return {
    ...actual,
    useTradeLive: (trades: readonly { id: string; code: string }[]) => {
      live.subscribe(trades);
      return actual.useTradeLive(trades);
    },
  };
});

beforeEach(() => {
  api.call.mockReset();
  live.subscribe.mockClear();
});
afterEach(cleanup);

/** Shows what the hook hands a screen, as text a test can find. */
function Probe(): React.JSX.Element {
  const all = useAllTrades();
  if (all.isPending) return <p>loading</p>;
  if (all.isError) return <p>failed</p>;
  return (
    <div>
      <p>{`count ${String(all.trades.length)}`}</p>
      <p>{all.complete ? 'complete' : 'partial'}</p>
      <p>{all.nextPageFailed ? 'next failed' : 'next ok'}</p>
    </div>
  );
}

const cursorOf = (query: Record<string, unknown> | undefined) => query?.cursor;

describe('every trade the person is party to, for home and search', () => {
  it('reads each page in turn, following the cursor exactly as it came, until the list is exhausted', async () => {
    answerWith(api.call, {
      'GET /trades': ({ query }: { query?: Record<string, unknown> }) =>
        cursorOf(query) === undefined
          ? { items: [listItem(1)], nextCursor: 'a b+c==' }
          : { items: [listItem(2), listItem(3)], nextCursor: null },
    });
    renderWithApi(api.call, <Probe />);

    expect(await screen.findByText('count 3')).toBeTruthy();
    expect(screen.getByText('complete')).toBeTruthy();
    expect(callsTo(api.call, 'GET', '/trades').map((call) => call.query?.cursor)).toEqual([
      undefined,
      'a b+c==',
    ]);
    expect(callsTo(api.call, 'GET', '/trades')[0]?.query).toMatchObject({ state: 'ALL' });
  });

  it('stops asking and reports the failure when a later page cannot be read, instead of looping', async () => {
    const failure = new ProblemError(
      { type: 'about:blank', title: 'down', status: 503, code: 'UNAVAILABLE' },
      { status: 503, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
      true,
    );
    answerWith(api.call, {
      'GET /trades': ({ query }: { query?: Record<string, unknown> }) =>
        cursorOf(query) === undefined ? { items: [listItem(1)], nextCursor: 'next' } : failure,
    });
    renderWithApi(api.call, <Probe />);

    expect(await screen.findByText('next failed')).toBeTruthy();
    // Let anything scheduled run, then check nothing re-asked: the count stays at the two that were made.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(callsTo(api.call, 'GET', '/trades')).toHaveLength(2);
  });

  it('subscribes only to the trades that are still open, not to finished ones', async () => {
    answerWith(api.call, {
      'GET /trades': {
        items: [
          listItem(1, { attention: 'PAY', status: 'PENDING_PAYMENT' }),
          listItem(2, { attention: null, status: 'CANCELLED' }),
          listItem(3, { attention: null, status: 'PENDING_PAYMENT' }),
        ],
        nextCursor: null,
      },
    });
    renderWithApi(api.call, <Probe />);
    expect(await screen.findByText('count 3')).toBeTruthy();
    const latest = live.subscribe.mock.calls.at(-1)?.[0] as { id: string }[];
    expect(latest.map((trade) => trade.id)).toEqual([id(1), id(3)]);
  });
});
