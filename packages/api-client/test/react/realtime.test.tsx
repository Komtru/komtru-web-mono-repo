// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SocketLike } from '../../src/realtime/connection.js';
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

  const socket: SocketLike = { ...bind(socketHandlers), disconnect: vi.fn(), io: bind(managerHandlers) };

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
    renderWithProvider(<NotificationBell />, { socket });
    await waitFor(() => expect(screen.getByTestId('unread').textContent).toBe('0'));

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
