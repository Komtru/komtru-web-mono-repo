// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SocketLike } from '../../src/realtime/connection.js';
import { fakeSocket as fakeRoomSocket } from '../support/fake-socket.js';
import { RealtimeProvider, useNotifications, useSocket, useSocketEvent } from '../../src/react/realtime.js';

type Handler = (...args: never[]) => void;

const fakeSocket = () => {
  const socketHandlers = new Map<string, Set<Handler>>();
  const managerHandlers = new Map<string, Set<Handler>>();

  const bind = (map: Map<string, Set<Handler>>) => ({
    on: (event: string, handler: Handler) => {
      const set = map.get(event) ?? new Set<Handler>();
      set.add(handler);
      map.set(event, set);
    },
    off: (event: string, handler: Handler) => {
      map.get(event)?.delete(handler);
    },
  });

  const fire = (map: Map<string, Set<Handler>>, event: string, ...args: unknown[]) => {
    act(() => {
      for (const handler of [...(map.get(event) ?? [])]) (handler as (...a: unknown[]) => void)(...args);
    });
  };

  const socket: SocketLike = {
    ...bind(socketHandlers),
    disconnect: vi.fn(),
    emit: vi.fn(),
    emitWithAck: vi.fn(() => Promise.resolve({ joined: true })),
    io: bind(managerHandlers),
  };

  return {
    socket,
    emit: (event: string, ...args: unknown[]) => fire(socketHandlers, event, ...args),
    emitManager: (event: string) => fire(managerHandlers, event),
    listenerCount: () =>
      [...socketHandlers.values(), ...managerHandlers.values()].reduce((n, set) => n + set.size, 0),
  };
};

const renderWithProvider = (
  children: ReactNode,
  options: { socket: SocketLike; resyncQueryKeys?: readonly (readonly unknown[])[] },
) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider
        token="socket-token"
        url="http://socket.test"
        connect={() => options.socket}
        {...(options.resyncQueryKeys ? { resyncQueryKeys: options.resyncQueryKeys } : {})}
      >
        {children}
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
};

const ConnectionBadge = () => {
  const { socket, connected } = useSocket();
  return (
    <div>
      <span data-testid="has-socket">{socket === null ? 'no' : 'yes'}</span>
      <span data-testid="connected">{connected ? 'yes' : 'no'}</span>
    </div>
  );
};

const NotificationBell = () => {
  const { unreadCount, notifications, markAllRead } = useNotifications();
  return (
    <div>
      <span data-testid="unread">{unreadCount}</span>
      <span data-testid="latest">{JSON.stringify(notifications[0]?.payload ?? null)}</span>
      <button type="button" onClick={markAllRead}>
        mark read
      </button>
    </div>
  );
};

afterEach(() => {
  // Vitest is not running with globals, so Testing Library's own auto-cleanup never registers.
  cleanup();
  vi.restoreAllMocks();
});

describe('RealtimeProvider', () => {
  it('hands the socket to consumers and tracks the connection', async () => {
    const { socket, emit } = fakeSocket();
    renderWithProvider(<ConnectionBadge />, { socket });

    // The guide's own sample keeps the socket in a ref, so this never becomes "yes".
    await waitFor(() => expect(screen.getByTestId('has-socket').textContent).toBe('yes'));
    expect(screen.getByTestId('connected').textContent).toBe('no');

    emit('connect');
    expect(screen.getByTestId('connected').textContent).toBe('yes');

    emit('disconnect');
    expect(screen.getByTestId('connected').textContent).toBe('no');
  });

  it('counts the notifications pushed to the user and clears them on demand', async () => {
    const { socket, emit } = fakeSocket();
    renderWithProvider(
      <>
        <ConnectionBadge />
        <NotificationBell />
      </>,
      { socket },
    );
    // The subscription only exists once the socket reaches the context, one tick after mount.
    await waitFor(() => expect(screen.getByTestId('has-socket').textContent).toBe('yes'));

    emit('notification', { kind: 'trade.funded' });
    emit('notification', { kind: 'trade.shipped' });

    expect(screen.getByTestId('unread').textContent).toBe('2');
    expect(screen.getByTestId('latest').textContent).toContain('trade.shipped');

    act(() => screen.getByRole('button', { name: 'mark read' }).click());
    expect(screen.getByTestId('unread').textContent).toBe('0');
  });

  it('refetches the named queries when the socket comes back', async () => {
    const { socket, emitManager } = fakeSocket();
    const { queryClient } = renderWithProvider(<ConnectionBadge />, {
      socket,
      resyncQueryKeys: [['notifications'], ['trades']],
    });
    await waitFor(() => expect(screen.getByTestId('has-socket').textContent).toBe('yes'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    emitManager('reconnect');

    expect(invalidate.mock.calls).toEqual([[{ queryKey: ['notifications'] }], [{ queryKey: ['trades'] }]]);
  });

  it('refetches everything when no resync keys are named', async () => {
    const { socket, emitManager } = fakeSocket();
    const { queryClient } = renderWithProvider(<ConnectionBadge />, { socket });
    await waitFor(() => expect(screen.getByTestId('has-socket').textContent).toBe('yes'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    emitManager('reconnect');

    expect(invalidate).toHaveBeenCalledWith();
  });

  it('disconnects and drops every listener on unmount', async () => {
    const { socket, listenerCount } = fakeSocket();
    const { unmount } = renderWithProvider(<ConnectionBadge />, { socket });
    await waitFor(() => expect(listenerCount()).toBeGreaterThan(0));

    unmount();

    expect(listenerCount()).toBe(0);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('useSocketEvent', () => {
  it('subscribes while mounted and stops when the component goes', async () => {
    const { socket, emit } = fakeSocket();
    const received: unknown[] = [];
    const Listener = () => {
      useSocketEvent('parcel.scanned', (payload) => received.push(payload));
      return <ConnectionBadge />;
    };

    const { unmount } = renderWithProvider(<Listener />, { socket });
    await waitFor(() => expect(screen.getByTestId('has-socket').textContent).toBe('yes'));

    emit('parcel.scanned', { id: 'p1' });
    unmount();
    emit('parcel.scanned', { id: 'p2' });

    expect(received).toEqual([{ id: 'p1' }]);
  });
});

describe('a token that changes while connected', () => {
  it('is forwarded to the gateway as auth:token without reconnecting', async () => {
    const { socket } = fakeRoomSocket();
    const connect = vi.fn(() => socket);
    const queryClient = new QueryClient();
    const tree = (token: string) => (
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider token={token} url="http://socket.test" connect={connect}>
          <ConnectionBadge />
        </RealtimeProvider>
      </QueryClientProvider>
    );
    const view = render(tree('first'));
    await waitFor(() => expect(screen.getByTestId('has-socket').textContent).toBe('yes'));
    expect(socket.emit).not.toHaveBeenCalled();

    view.rerender(tree('second'));
    expect(socket.emit).toHaveBeenCalledWith('auth:token', { token: 'second' });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('does not connect at all until there is a token, and then connects as that person', async () => {
    const { socket } = fakeRoomSocket();
    const connect = vi.fn(() => socket);
    const queryClient = new QueryClient();
    const tree = (token: string) => (
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider token={token} url="http://socket.test" connect={connect}>
          <ConnectionBadge />
        </RealtimeProvider>
      </QueryClientProvider>
    );
    const view = render(tree(''));
    await Promise.resolve();
    expect(connect).not.toHaveBeenCalled();

    view.rerender(tree('minted'));
    await waitFor(() =>
      expect(connect).toHaveBeenCalledWith('http://socket.test', 'minted', expect.any(Function)),
    );
  });
});

describe('a token that lapses on a screen that is only listening', () => {
  const mount = (refreshToken?: () => Promise<string | null>, token = 'first') => {
    const fake = fakeRoomSocket();
    const connect = vi.fn((_url: string, _token: string, _latest?: () => string) => fake.socket);
    const queryClient = new QueryClient();
    const tree = (t: string) => (
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider
          token={t}
          url="http://socket.test"
          connect={connect}
          {...(refreshToken ? { refreshToken } : {})}
        >
          <ConnectionBadge />
        </RealtimeProvider>
      </QueryClientProvider>
    );
    const view = render(tree(token));
    return { fake, connect, rerender: (t: string) => view.rerender(tree(t)) };
  };

  it('hands the connection a way to read the NEWEST token, so a reconnect does not present the first', async () => {
    const { fake, connect, rerender } = mount();
    await waitFor(() => expect(connect).toHaveBeenCalled());
    const latest = connect.mock.calls[0]![2]!;
    expect(latest()).toBe('first');
    rerender('second');
    expect(latest()).toBe('second');
    void fake;
  });

  it('answers the gateway asking for a fresh token by refreshing one and sending it, with no request involved', async () => {
    const refresh = vi.fn(() => Promise.resolve('fresh'));
    const { fake } = mount(refresh);
    await waitFor(() => expect(screen.getByTestId('has-socket').textContent).toBe('yes'));
    fake.fire('auth:refresh');
    await waitFor(() => expect(fake.socket.emit).toHaveBeenCalledWith('auth:token', { token: 'fresh' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('sends the fresh token to a later reconnect too, not the stale one it opened with', async () => {
    const { fake, connect } = mount(() => Promise.resolve('fresh'));
    await waitFor(() => expect(connect).toHaveBeenCalled());
    const latest = connect.mock.calls[0]![2]!;
    fake.fire('auth:refresh');
    await waitFor(() => expect(latest()).toBe('fresh'));
  });

  it.each([
    ['the session is over', () => Promise.resolve(null)],
    ['the refresh fails', () => Promise.reject(new Error('offline'))],
  ])('sends nothing and does not throw when %s', async (_name, refresh) => {
    const { fake } = mount(refresh);
    await waitFor(() => expect(screen.getByTestId('has-socket').textContent).toBe('yes'));
    fake.fire('auth:refresh');
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.socket.emit).not.toHaveBeenCalled();
  });

  it('does nothing when the app gave no way to refresh', async () => {
    const { fake } = mount();
    await waitFor(() => expect(screen.getByTestId('has-socket').textContent).toBe('yes'));
    expect(() => {
      fake.fire('auth:refresh');
    }).not.toThrow();
    expect(fake.socket.emit).not.toHaveBeenCalled();
  });
});
