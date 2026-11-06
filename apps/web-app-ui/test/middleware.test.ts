// The real middleware, over real `NextRequest`s: `hosts.test.ts` proves the rules, this proves they
// are wired to the responses Next acts on — and that the session gate sits behind them.
import { createSessionSealer } from '@komtru/app-kit';
import { KOMTRU_MATCHER } from '@komtru/app-kit/next';
import type { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';

const SECRET = 'test-secret-that-is-long-enough-32';

const ENV = {
  NEXT_PUBLIC_KOMTRU_APP_URL: 'https://app.komtru.com',
  NEXT_PUBLIC_KOMTRU_API_URL: 'https://api.komtru.com/v1',
  NEXT_PUBLIC_KOMTRU_PASSPORT_URL: 'https://passport.komtru.com',
  NEXT_PUBLIC_KOMTRU_PARK_URL: 'https://park.komtru.com',
  KOMTRU_SESSION_SECRET: SECRET,
};

type Middleware = (request: NextRequest) => Promise<{ status: number; headers: Headers }>;

let middleware: Middleware;
let matcher: readonly string[];

beforeAll(async () => {
  Object.assign(process.env, ENV);
  // Imported after the environment is in place: the module reads it once, at module scope, which is
  // what makes a misconfigured deployment fail at boot rather than on a request.
  const loaded = await import('../middleware.js');
  middleware = loaded.default;
  matcher = loaded.config.matcher;
});

const { NextRequest: Request_ } = await import('next/server');

/**
 * A request as the **Node server** builds it: the URL carries the origin the server is listening on,
 * and the host the visitor asked for is in the `Host` header. `next start` never produces a
 * `nextUrl` whose host is the public one, which is why a test that passed a public URL straight in
 * proved nothing about a deployment.
 */
const request = (url: string, options: { cookie?: string; host?: string; forwarded?: string } = {}) => {
  const target = new URL(url);
  const headers = new Headers({ host: options.host ?? target.host });
  if (options.forwarded !== undefined) headers.set('x-forwarded-host', options.forwarded);
  if (options.cookie !== undefined) headers.set('cookie', `komtru_session=${options.cookie}`);
  return new Request_(new URL(`${target.pathname}${target.search}`, SERVER_ORIGIN), { headers });
};

/** What the server itself is listening on, which is all `request.nextUrl` ever knows. */
const SERVER_ORIGIN = 'http://localhost:3001';

const sealed = async (scope: 'CONSUMER' | 'STAFF'): Promise<string> =>
  createSessionSealer(SECRET).seal({ scope, expiresAt: Date.now() + 60_000 });

describe('host rules, before anything asks for a session', () => {
  it('sends an operating /hub URL to the Park app, temporarily', async () => {
    const response = await middleware(request('https://app.komtru.com/hub/log-arrival'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://park.komtru.com/log-arrival');
  });

  it('serves a passport host path from the passport routes without changing the URL', async () => {
    // The host arrives in the `Host` header, which is the only place a self-hosted Node server puts
    // it: `nextUrl` carries the origin the server is bound to, not the one the visitor typed.
    const response = await middleware(request('https://passport.komtru.com/techedge-ng?from=whatsapp'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      `${SERVER_ORIGIN}/passport/techedge-ng?from=whatsapp`,
    );
  });

  it('reads the host a proxy forwarded, which is where it is behind a load balancer', async () => {
    const response = await middleware(
      request('https://app.komtru.com/techedge-ng', { forwarded: 'passport.komtru.com' }),
    );
    expect(response.headers.get('x-middleware-rewrite')).toBe(`${SERVER_ORIGIN}/passport/techedge-ng`);
  });

  it('still runs the session gate on the path the rewrite will serve', async () => {
    // The passport host is decided from a header the caller controls. The gate therefore runs on
    // the rewritten path rather than being skipped by the rewrite: `/passport/*` is public, and a
    // forged `Host` buys a visitor exactly that and nothing else.
    const response = await middleware(
      request('https://passport.komtru.com/trades', { host: 'passport.komtru.com' }),
    );
    expect(response.headers.get('x-middleware-rewrite')).toBe(`${SERVER_ORIGIN}/passport/trades`);
  });

  it('lets a stranger read a passport page with no session at all', async () => {
    const response = await middleware(request('https://app.komtru.com/passport/techedge-ng'));
    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBe(200);
  });
});

describe('the session gate', () => {
  it('turns a visitor with no session away from a gated path', async () => {
    const response = await middleware(request('https://app.komtru.com/settings'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://app.komtru.com/sign-in?next=%2Fsettings');
  });

  it('lets a CONSUMER session through', async () => {
    const response = await middleware(
      request('https://app.komtru.com/settings', { cookie: await sealed('CONSUMER') }),
    );
    expect(response.status).toBe(200);
  });

  it('sends a STAFF session to sign in here rather than showing it a consumer screen', async () => {
    const response = await middleware(
      request('https://app.komtru.com/settings', { cookie: await sealed('STAFF') }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/sign-in?error=wrong-scope');
  });

  it('serves the screens the scaffold has to draw before sign-in exists', async () => {
    // T-111 deletes PRE_AUTH_PUBLIC_PATHS; until it does, these are reachable with no session.
    const paths = [
      '/home',
      '/trades',
      '/orders',
      '/listings',
      '/shop',
      '/browse',
      '/alerts',
      '/messages',
      '/account',
      '/hub/register',
    ];
    for (const path of paths) {
      const response = await middleware(request(`https://app.komtru.com${path}`));
      expect(response.status, path).toBe(200);
    }
  });

  it('gates /explore now that Discover is /browse: v1 never shipped, so there is nothing to redirect', async () => {
    const response = await middleware(request('https://app.komtru.com/explore'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/sign-in');
  });

  it('is never asked about the auth routes, which are the only way to get a session', async () => {
    const response = await middleware(request('https://app.komtru.com/api/auth/login'));
    expect(response.status).toBe(200);
  });
});

describe('the matcher', () => {
  it('is `KOMTRU_MATCHER`, which Next makes us write out as a literal', () => {
    expect(matcher).toEqual([...KOMTRU_MATCHER]);
  });

  it('keeps the build output and the service worker off the hot path', () => {
    const pattern = new RegExp(matcher[0]!);
    expect(pattern.test('/_next/static/chunk.js')).toBe(false);
    expect(pattern.test('/sw.js')).toBe(false);
    expect(pattern.test('/trades')).toBe(true);
  });
});
