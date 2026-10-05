import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authRoutePaths,
  backendLoginPath,
  createRouteHandlerRefresh,
  createTokenStore,
  type AuthSession,
} from '../../src/auth/session.js';
import { deferred } from '../support/deferred.js';
import { startStubServer, type StubServer } from '../support/stub-server.js';

const session = (accessToken: string): AuthSession => ({ accessToken, scope: 'CONSUMER' });

describe('createTokenStore', () => {
  it('refreshes once for two callers that raced on the same token', async () => {
    const gate = deferred<AuthSession | null>();
    let calls = 0;
    const store = createTokenStore({
      refresh: () => {
        calls += 1;
        return gate.promise;
      },
    });
    store.set(session('old'));

    const seen = store.read().generation;
    const first = store.refreshOnce(seen);
    const second = store.refreshOnce(seen);
    gate.resolve(session('new'));

    expect((await first).accessToken).toBe('new');
    expect((await second).accessToken).toBe('new');
    expect(calls).toBe(1);
  });

  it('does not refresh again for a request that was still using the old token', async () => {
    let calls = 0;
    const store = createTokenStore({
      refresh: () => {
        calls += 1;
        return Promise.resolve(session(`token-${String(calls)}`));
      },
    });
    store.set(session('old'));

    const stale = store.read().generation;
    expect((await store.refreshOnce(stale)).accessToken).toBe('token-1');
    // A second request that read `old` before the refresh landed: it just retries with the new one.
    expect((await store.refreshOnce(stale)).accessToken).toBe('token-1');
    expect(calls).toBe(1);
  });

  it('refreshes again for a 401 on the token the last refresh produced', async () => {
    let calls = 0;
    const store = createTokenStore({
      refresh: () => {
        calls += 1;
        return Promise.resolve(session(`token-${String(calls)}`));
      },
    });
    store.set(session('old'));

    await store.refreshOnce(store.read().generation);
    expect((await store.refreshOnce(store.read().generation)).accessToken).toBe('token-2');
    expect(calls).toBe(2);
  });

  it('ends the session exactly once when the refresh says it is over', async () => {
    const gate = deferred<AuthSession | null>();
    const onSessionEnded = vi.fn();
    const store = createTokenStore({ refresh: () => gate.promise, onSessionEnded });
    store.set(session('old'));

    const seen = store.read().generation;
    const first = store.refreshOnce(seen);
    const second = store.refreshOnce(seen);
    gate.resolve(null);

    expect((await first).accessToken).toBeNull();
    expect((await second).accessToken).toBeNull();
    expect(store.read().accessToken).toBeNull();
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
  });

  it('lets the next caller try again after a refresh rejects', async () => {
    let calls = 0;
    const store = createTokenStore({
      refresh: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(session('new'));
      },
    });
    store.set(session('old'));

    const seen = store.read().generation;
    await expect(store.refreshOnce(seen)).rejects.toThrow('offline');
    // The failure did not bump the generation, so the same request may try again.
    expect((await store.refreshOnce(seen)).accessToken).toBe('new');
    expect(calls).toBe(2);
  });

  it('tells subscribers when the session changes', () => {
    const seen: (AuthSession | null)[] = [];
    const store = createTokenStore({ refresh: () => Promise.resolve(null) });
    const unsubscribe = store.subscribe((next) => seen.push(next));
    store.set(session('a'));
    unsubscribe();
    store.set(session('b'));
    expect(seen).toEqual([session('a')]);
  });

  it('exposes the live session, so an app can read the scope it is signed in with', () => {
    const store = createTokenStore({ refresh: () => Promise.resolve(null) });
    expect(store.session()).toBeNull();
    store.set({ accessToken: 'a', scope: 'LOGISTICS' });
    expect(store.session()).toEqual({ accessToken: 'a', scope: 'LOGISTICS' });
  });

  it('bumps the generation on every explicit set', () => {
    const store = createTokenStore({ refresh: () => Promise.resolve(null) });
    const before = store.read().generation;
    store.set(session('a'));
    expect(store.read().generation).toBeGreaterThan(before);
  });
});

describe('the app auth routes', () => {
  it('points at the app’s own route handlers, never at the backend', () => {
    expect(authRoutePaths()).toEqual({
      login: '/api/auth/login',
      refresh: '/api/auth/refresh',
      logout: '/api/auth/logout',
    });
    expect(authRoutePaths('/api/park-auth').refresh).toBe('/api/park-auth/refresh');
  });

  it('names the backend login route for each scope (design §7.3)', () => {
    expect(backendLoginPath('CONSUMER')).toBe('/auth/consumer/login');
    expect(backendLoginPath('STAFF')).toBe('/auth/staff/login');
    expect(backendLoginPath('LOGISTICS')).toBe('/auth/logistics/login');
  });
});

describe('createRouteHandlerRefresh', () => {
  let server: StubServer;

  beforeEach(async () => {
    server = await startStubServer();
  });

  afterEach(async () => {
    await server.close();
  });

  const refresh = () => createRouteHandlerRefresh({ base: `${server.url}/api/auth` });

  it('parses the session the route handler returns', async () => {
    server.reply(() => ({
      status: 200,
      body: { accessToken: 'fresh', scope: 'LOGISTICS', expiresAt: 1_790_000_000_000 },
    }));
    await expect(refresh()()).resolves.toEqual({
      accessToken: 'fresh',
      scope: 'LOGISTICS',
      expiresAt: 1_790_000_000_000,
    });
    expect(server.requests[0]?.method).toBe('POST');
    expect(server.requests[0]?.url).toBe('/api/auth/refresh');
  });

  it('reads a 401 as the session being over, not as an error', async () => {
    server.reply(() => ({
      status: 401,
      body: { type: 'about:blank', title: 'Not signed in', status: 401, code: 'UNAUTHENTICATED' },
    }));
    await expect(refresh()()).resolves.toBeNull();
  });

  it('raises anything else, so a 500 is not mistaken for a sign-out', async () => {
    server.reply(() => ({
      status: 500,
      body: { type: 'about:blank', title: 'Boom', status: 500, code: 'INTERNAL' },
    }));
    await expect(refresh()()).rejects.toMatchObject({ name: 'ProblemError', status: 500 });
  });
});
