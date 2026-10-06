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

const request = (url: string, cookie?: string): NextRequest =>
  new Request_(new URL(url), {
    headers: cookie === undefined ? undefined : { cookie: `komtru_session=${cookie}` },
  });

const sealed = async (scope: 'CONSUMER' | 'STAFF'): Promise<string> =>
  createSessionSealer(SECRET).seal({ scope, expiresAt: Date.now() + 60_000 });

describe('host rules, before anything asks for a session', () => {
  it('sends an operating /hub URL to the Park app, temporarily', async () => {
    const response = await middleware(request('https://app.komtru.com/hub/log-arrival'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://park.komtru.com/log-arrival');
  });

  it('serves a passport host path from the passport routes without changing the URL', async () => {
    const response = await middleware(request('https://passport.komtru.com/techedge-ng?from=whatsapp'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://passport.komtru.com/passport/techedge-ng?from=whatsapp',
    );
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
    const response = await middleware(request('https://app.komtru.com/settings', await sealed('CONSUMER')));
    expect(response.status).toBe(200);
  });

  it('sends a STAFF session to sign in here rather than showing it a consumer screen', async () => {
    const response = await middleware(request('https://app.komtru.com/settings', await sealed('STAFF')));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/sign-in?error=wrong-scope');
  });

  it('serves the screens the scaffold has to draw before sign-in exists', async () => {
    // T-111 deletes PRE_AUTH_PUBLIC_PATHS; until it does, these are reachable with no session.
    for (const path of ['/trades', '/explore', '/alerts', '/messages', '/account', '/hub/register']) {
      const response = await middleware(request(`https://app.komtru.com${path}`));
      expect(response.status, path).toBe(200);
    }
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
