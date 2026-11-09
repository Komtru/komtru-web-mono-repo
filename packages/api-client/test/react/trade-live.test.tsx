// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeProvider } from '../../src/react/realtime.js';
import { isStalePush, PUSH_SKEW_ALLOWANCE_MS, useTradeLive } from '../../src/react/tradeLive.js';
import { tradeKeys } from '../../src/react/trades.js';
import { fakeSocket } from '../support/fake-socket.js';

const A = { id: '0190b0a0-0000-7000-8000-000000000001', code: 'KMT-9042800-NG' };
const B = { id: '0190b0a0-0000-7000-8000-000000000002', code: 'KMT-9042801-NG' };

const push = (over: Record<string, unknown> = {}) => ({
  tradeId: A.id,
  tradeCode: A.code,
  kind: 'STATE_CHANGED',
  status: 'FUNDED',
  previousStatus: 'PENDING_PAYMENT',
  action: 'FUND',
  occurredAt: new Date().toISOString(),
  ...over,
});

/** The server's copy of each trade: what the screen may show, however a push words it. */
let server: Record<string, string>;
const reads = vi.fn<(id: string) => void>();
const listReads = vi.fn();
/** While set, a read of a trade waits for it: lets a test look at the screen mid-refetch. */
let gate: Promise<void> | null = null;

function Probe({ trades }: { trades: { id: string; code: string }[] }) {
  const live = useTradeLive(trades);
  return (
    <div>
      {trades.map((trade) => (
        <TradeStatus key={trade.id} id={trade.id} />
      ))}
      <ListProbe />
      <span data-testid="refused">{live.refused.join(',')}</span>
    </div>
  );
}

function ListProbe() {
  useQuery({
    queryKey: tradeKeys.list('ALL'),
    queryFn: () => {
      listReads();
      return Promise.resolve([]);
    },
    staleTime: Infinity,
  });
  return null;
}

function TradeStatus({ id }: { id: string }) {
  const q = useQuery({
    queryKey: tradeKeys.one(id),
    queryFn: async () => {
      reads(id);
      if (gate) await gate;
      return server[id] ?? 'GONE';
    },
    staleTime: Infinity,
  });
  return <span data-testid={`status-${id}`}>{q.data ?? '…'}</span>;
}

const mount = (fake: ReturnType<typeof fakeSocket>, trades: { id: string; code: string }[]) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (list: typeof trades) => (
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider token="t" url="http://socket.test" connect={() => fake.socket}>
        <Probe trades={list} />
      </RealtimeProvider>
    </QueryClientProvider>
  );
  const view = render(tree(trades));
  return { queryClient, rerender: (list: typeof trades) => view.rerender(tree(list)), unmount: view.unmount };
};

const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

afterEach(() => {
  cleanup();
  reads.mockReset();
  listReads.mockReset();
  gate = null;
});

/** The provider connects asynchronously: wait for the screen to be listening, then connect as socket.io does. */
const connect = async (fake: ReturnType<typeof fakeSocket>) => {
  await waitFor(() => expect(fake.listenerCount('trade:updated')).toBe(1));
  act(() => {
    fake.fire('connect');
  });
};

describe('joining the room of every open trade', () => {
  it('joins each trade by its canonical code when the socket connects, then reads it again', async () => {
    server = { [A.id]: 'PENDING_PAYMENT', [B.id]: 'FUNDED' };
    const fake = fakeSocket();
    mount(fake, [A, B]);
    await waitFor(() => expect(screen.getByTestId(`status-${A.id}`).textContent).toBe('PENDING_PAYMENT'));
    expect(fake.joins()).toEqual([]); // not before the socket is connected
    reads.mockClear();

    await connect(fake);
    await waitFor(() => expect(reads).toHaveBeenCalledTimes(2));
    expect(fake.joins()).toEqual([
      { prefix: 'trade', id: A.code },
      { prefix: 'trade', id: B.code },
    ]);
  });

  it('REJOINS every room on every reconnect and READS every trade again, which is the only way to recover a missed push', async () => {
    server = { [A.id]: 'PENDING_PAYMENT', [B.id]: 'PENDING_PAYMENT' };
    const fake = fakeSocket();
    mount(fake, [A, B]);
    await connect(fake);
    await waitFor(() => expect(fake.joins()).toHaveLength(2));
    await settle();
    reads.mockClear();

    // The connection drops; the server moves the trade while this device cannot hear a push.
    server[A.id] = 'SHIPPED';
    act(() => {
      fake.fire('disconnect');
    });
    act(() => {
      fake.fire('connect'); // the reconnect
    });

    await waitFor(() => expect(fake.joins()).toHaveLength(4));
    expect(fake.joins().slice(2)).toEqual([
      { prefix: 'trade', id: A.code },
      { prefix: 'trade', id: B.code },
    ]);
    await waitFor(() => expect(screen.getByTestId(`status-${A.id}`).textContent).toBe('SHIPPED'));
    expect(reads.mock.calls.map(([id]) => id).sort()).toEqual([A.id, B.id].sort());

    // And again on the next one: it is not a one-off.
    reads.mockClear();
    act(() => {
      fake.fire('connect');
    });
    await waitFor(() => expect(fake.joins()).toHaveLength(6));
    await waitFor(() => expect(reads).toHaveBeenCalledTimes(2));
  });

  it('joins at once when the socket was already connected before the screen opened', async () => {
    server = { [A.id]: 'FUNDED' };
    const fake = fakeSocket();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Late() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          {open && <Probe trades={[A]} />}
        </>
      );
    }
    render(
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider token="t" url="http://socket.test" connect={() => fake.socket}>
          <Late />
        </RealtimeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(fake.listenerCount('connect')).toBeGreaterThan(0));
    act(() => {
      fake.fire('connect');
    });
    await settle();
    act(() => {
      screen.getByText('open').click();
    });
    await waitFor(() => expect(fake.joins()).toEqual([{ prefix: 'trade', id: A.code }]));
  });

  it('reports a refused room, still shows the trade, and still reads it', async () => {
    server = { [A.id]: 'FUNDED' };
    const fake = fakeSocket();
    fake.answerJoins(() => ({ joined: false, reason: 'FORBIDDEN' }));
    mount(fake, [A]);
    await connect(fake);
    await waitFor(() => expect(screen.getByTestId('refused').textContent).toBe(A.code));
    expect(screen.getByTestId(`status-${A.id}`).textContent).toBe('FUNDED');
  });

  it('survives a join whose emit fails, reading the trade instead of throwing', async () => {
    server = { [A.id]: 'FUNDED' };
    const fake = fakeSocket();
    fake.emitWithAck.mockRejectedValue(new Error('socket dropped'));
    mount(fake, [A]);
    await waitFor(() => expect(screen.getByTestId(`status-${A.id}`).textContent).toBe('FUNDED'));
    reads.mockClear();
    await connect(fake);
    await waitFor(() => expect(reads).toHaveBeenCalledWith(A.id));
    expect(screen.getByTestId('refused').textContent).toBe(A.code);
  });

  it('joins a room it did not have before when the set of trades grows', async () => {
    server = { [A.id]: 'FUNDED', [B.id]: 'FUNDED' };
    const fake = fakeSocket();
    const view = mount(fake, [A]);
    await connect(fake);
    await waitFor(() => expect(fake.joins()).toHaveLength(1));
    // Pre-set the socket as connected so the new set joins straight away.
    view.rerender([A, B]);
    await waitFor(() => expect(fake.joins().map((j) => (j as { id: string }).id)).toContain(B.code));
  });
});

describe('a push is a signal to refetch, never data', () => {
  const connected = async (trades = [A]) => {
    server = { [A.id]: 'PENDING_PAYMENT', [B.id]: 'PENDING_PAYMENT' };
    const fake = fakeSocket();
    const view = mount(fake, trades);
    await connect(fake);
    await waitFor(() => expect(fake.joins().length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByTestId(`status-${A.id}`).textContent).toBe('PENDING_PAYMENT'));
    await settle();
    reads.mockClear();
    return { fake, ...view };
  };

  it('shows what the server says on the refetch, not what the push says', async () => {
    const { fake } = await connected();
    // The push claims FUNDED, the server (the truth, and what this person may see) says SHIPPED.
    server[A.id] = 'SHIPPED';
    act(() => {
      fake.fire('trade:updated', push({ status: 'FUNDED' }));
    });
    await waitFor(() => expect(screen.getByTestId(`status-${A.id}`).textContent).toBe('SHIPPED'));
    expect(screen.queryByText('FUNDED')).toBeNull();
  });

  it('does not change the screen until the refetch has answered', async () => {
    const { fake } = await connected();
    let release: () => void = () => undefined;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server[A.id] = 'FUNDED';
    act(() => {
      fake.fire('trade:updated', push({ status: 'FUNDED' }));
    });
    await waitFor(() => expect(reads).toHaveBeenCalledWith(A.id));
    // The push has been heard and the read is under way: the screen still shows what it last read.
    expect(screen.getByTestId(`status-${A.id}`).textContent).toBe('PENDING_PAYMENT');
    release();
    await waitFor(() => expect(screen.getByTestId(`status-${A.id}`).textContent).toBe('FUNDED'));
  });

  it('ignores a push older than the last read, which a redelivery or an out-of-order push would be', async () => {
    const { fake } = await connected();
    const old = new Date(Date.now() - 10 * PUSH_SKEW_ALLOWANCE_MS).toISOString();
    act(() => {
      fake.fire('trade:updated', push({ occurredAt: old }));
    });
    await settle();
    expect(reads).not.toHaveBeenCalled();
  });

  it('refetches for a push newer than the last read', async () => {
    const { fake } = await connected();
    server[A.id] = 'SHIPPED';
    act(() => {
      fake.fire('trade:updated', push({ occurredAt: new Date(Date.now() + 1000).toISOString() }));
    });
    await waitFor(() => expect(reads).toHaveBeenCalledWith(A.id));
  });

  it.each([
    ['not an object', 'trade:updated'],
    ['missing its kind', { tradeId: A.id, tradeCode: A.code, occurredAt: new Date().toISOString() }],
    ['carrying a field the contract does not have', push({ reason: 'staff said so' })],
    ['a STATE_CHANGED without a status', push({ status: undefined })],
    ['a code that is not canonical', push({ tradeCode: 'kmt-9042800-ng' })],
  ])('drops a payload that is %s', async (_name, payload) => {
    const { fake } = await connected();
    act(() => {
      fake.fire('trade:updated', payload);
    });
    await settle();
    expect(reads).not.toHaveBeenCalled();
  });

  it('ignores a push for a trade this screen is not showing', async () => {
    const { fake } = await connected([A]);
    act(() => {
      fake.fire('trade:updated', push({ tradeId: B.id, tradeCode: B.code }));
    });
    await settle();
    expect(reads).not.toHaveBeenCalled();
  });

  it('refetches the trades list too, so MyTrades learns without waiting for focus', async () => {
    const { fake } = await connected();
    await waitFor(() => expect(listReads).toHaveBeenCalled());
    listReads.mockClear();
    act(() => {
      fake.fire('trade:updated', push({ occurredAt: new Date(Date.now() + 1000).toISOString() }));
    });
    await waitFor(() => expect(listReads).toHaveBeenCalledTimes(1));
  });

  it('removes its listeners when the screen goes', async () => {
    const { fake, unmount } = await connected();
    expect(fake.listenerCount('trade:updated')).toBe(1);
    unmount();
    expect(fake.listenerCount('trade:updated')).toBe(0);
  });
});

describe('isStalePush', () => {
  const now = Date.now();
  it('is never stale before anything has been read', () => {
    expect(isStalePush({ occurredAt: new Date(now - 1e9).toISOString() }, undefined)).toBe(false);
    expect(isStalePush({ occurredAt: new Date(now - 1e9).toISOString() }, 0)).toBe(false);
  });
  it('is stale only when older than the last read by more than the skew allowance', () => {
    expect(isStalePush({ occurredAt: new Date(now - PUSH_SKEW_ALLOWANCE_MS - 1).toISOString() }, now)).toBe(
      true,
    );
    expect(isStalePush({ occurredAt: new Date(now - 1000).toISOString() }, now)).toBe(false);
    expect(isStalePush({ occurredAt: new Date(now + 1000).toISOString() }, now)).toBe(false);
  });
});
