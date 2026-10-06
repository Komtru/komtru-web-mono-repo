// @vitest-environment jsdom
import {
  NetworkError,
  problemFromResponse,
  readResponseMeta,
  type AuthSession,
  type SocketLike,
} from '@komtru/api-client';
import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createKomtruQueryClient,
  KomtruProviders,
  useApiClient,
  useSession,
  type KomtruProvidersProps,
} from '../../src/react/providers.js';

const config = { apiUrl: 'https://api.komtru.com/v1', socketUrl: 'https://api.komtru.com' };
const session: AuthSession = { accessToken: 'at-1', scope: 'CONSUMER', expiresAt: 4_000_000_000_000 };

/** A socket the provider can drive without socket.io, plus the manager that emits `reconnect`. */
const emitter = () => {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  return {
    on(event: string, handler: (...args: never[]) => void) {
      const set = handlers.get(event) ?? new Set<(payload: unknown) => void>();
      set.add(handler as (payload: unknown) => void);
      handlers.set(event, set);
    },
    off(event: string, handler: (...args: never[]) => void) {
      handlers.get(event)?.delete(handler as (payload: unknown) => void);
    },
    emit(event: string, payload?: unknown) {
      for (const handler of [...(handlers.get(event) ?? [])]) handler(payload);
    },
  };
};

const fakeSocket = () => {
  const self = emitter();
  const manager = emitter();
  const disconnect = vi.fn();
  return { ...self, io: manager, disconnect, manager } as unknown as SocketLike & {
    emit: (event: string, payload?: unknown) => void;
    manager: ReturnType<typeof emitter>;
    disconnect: ReturnType<typeof vi.fn>;
  };
};

const renderWith = (props: Partial<KomtruProvidersProps>, children: React.ReactNode) =>
  render(
    <KomtruProviders config={config} session={null} {...props}>
      {children}
    </KomtruProviders>,
  );

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('KomtruProviders', () => {
  it('hands every consumer one client, and the same one across a re-render', () => {
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useApiClient());
      return <button type="button">probe</button>;
    }
    const { rerender } = renderWith({}, <Probe />);
    rerender(
      <KomtruProviders config={config} session={null}>
        <Probe />
      </KomtruProviders>,
    );
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen).size).toBe(1);
  });

  it('seeds the token store from the server-rendered session before the first child renders', () => {
    function Probe() {
      return <span>{useApiClient().tokens?.read().accessToken ?? 'none'}</span>;
    }
    renderWith({ session }, <Probe />);
    expect(screen.getByText('at-1')).toBeTruthy();
  });

  it('exposes the session itself, so a layout does not have to thread it down', () => {
    function Probe() {
      return <span>{useSession()?.scope ?? 'anonymous'}</span>;
    }
    renderWith({ session }, <Probe />);
    expect(screen.getByText('CONSUMER')).toBeTruthy();
  });

  it("refreshes through the app's own route handler, not the backend", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ accessToken: 'at-2', scope: 'CONSUMER' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    let client: ReturnType<typeof useApiClient> | undefined;
    function Probe() {
      client = useApiClient();
      return null;
    }
    renderWith({ session }, <Probe />);
    await client!.tokens!.refreshOnce(client!.tokens!.read().generation);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/refresh');
    expect(init.credentials).toBe('include');
    expect(client!.tokens!.read().accessToken).toBe('at-2');
  });

  it('calls onSessionEnded when the refresh says the session is over', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    const onSessionEnded = vi.fn();
    let client: ReturnType<typeof useApiClient> | undefined;
    function Probe() {
      client = useApiClient();
      return null;
    }
    renderWith({ session, onSessionEnded }, <Probe />);
    await client!.tokens!.refreshOnce(client!.tokens!.read().generation);
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
  });

  it('opens no socket without a token', () => {
    const connect = vi.fn();
    renderWith({ connect }, <span>page</span>);
    expect(connect).not.toHaveBeenCalled();
  });

  it('opens one when there is a token', async () => {
    const socket = fakeSocket();
    const connect = vi.fn().mockResolvedValue(socket);
    renderWith({ socketToken: 'socket-1', connect }, <span>page</span>);
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    expect(connect.mock.calls[0]).toEqual(['https://api.komtru.com', 'socket-1']);
  });

  it('invalidates the keys it was given when the socket reconnects', async () => {
    const socket = fakeSocket();
    const queryClient = createKomtruQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderWith(
      {
        socketToken: 'socket-1',
        connect: () => Promise.resolve(socket),
        resyncQueryKeys: [['trades']],
        queryClient,
      },
      <span>page</span>,
    );
    await waitFor(() => expect(invalidate).not.toHaveBeenCalled());
    socket.manager.emit('reconnect');
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['trades'] }));
  });

  it('throws a named error when useApiClient is called outside the provider', () => {
    function Orphan() {
      useApiClient();
      return null;
    }
    expect(() => render(<Orphan />)).toThrow(/KomtruProviders/);
  });
});

describe('createKomtruQueryClient', () => {
  it('retries a problem a repeat can fix and not one it cannot', () => {
    const retry = createKomtruQueryClient().getDefaultOptions().queries?.retry;
    expect(typeof retry).toBe('function');
    const decide = retry as (failureCount: number, error: unknown) => boolean;
    expect(decide(0, new NetworkError('offline'))).toBe(true);
    expect(
      decide(
        0,
        problemFromResponse(
          422,
          { status: 422, title: 'nope', type: 'about:blank', code: 'VALIDATION_FAILED' },
          readResponseMeta(new Headers(), 422),
        ),
      ),
    ).toBe(false);
  });

  it('is a QueryClient a caller can replace', () => {
    expect(createKomtruQueryClient()).toBeInstanceOf(QueryClient);
  });
});
