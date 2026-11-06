// The real middleware over real `NextRequest`s: STAFF passes, everything else is turned back at the
// door, and the pre-session doors stay open.
import { createSessionSealer } from '@komtru/app-kit';
import { KOMTRU_MATCHER } from '@komtru/app-kit/next';
import type { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';

const SECRET = 'test-secret-that-is-long-enough-32';

const ENV = {
  NEXT_PUBLIC_KOMTRU_APP_URL: 'https://ops.komtru.com',
  NEXT_PUBLIC_KOMTRU_API_URL: 'https://api.komtru.com/v1',
  KOMTRU_SESSION_SECRET: SECRET,
};

type Middleware = (request: NextRequest) => Promise<{ status: number; headers: Headers }>;

let middleware: Middleware;
let matcher: readonly string[];

beforeAll(async () => {
  Object.assign(process.env, ENV);
  // Imported after the environment is in place: the module reads it once, at module scope.
  const loaded = await import('../middleware.js');
  middleware = loaded.default;
  matcher = loaded.config.matcher;
});

const { NextRequest: Request_ } = await import('next/server');

const SERVER_ORIGIN = 'http://localhost:3002';

const request = (path: string, cookie?: string) =>
  new Request_(new URL(path, SERVER_ORIGIN), {
    headers: cookie === undefined ? {} : { cookie: `komtru_session=${cookie}` },
  });

const sealed = async (scope: 'CONSUMER' | 'STAFF' | 'LOGISTICS', expiresAt = Date.now() + 60_000) =>
  createSessionSealer(SECRET).seal({ scope, expiresAt });

const passes = (response: { status: number; headers: Headers }) =>
  response.status === 200 && response.headers.get('x-middleware-next') === '1';

describe('STAFF scope', () => {
  it('lets a STAFF session through to a console page', async () => {
    expect(passes(await middleware(request('/queue', await sealed('STAFF'))))).toBe(true);
    expect(passes(await middleware(request('/me', await sealed('STAFF'))))).toBe(true);
  });

  it('sends a visitor with no session to sign in, remembering where they were going', async () => {
    const response = await middleware(request('/disputes?status=open'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://ops.komtru.com');
    expect(location.pathname).toBe('/sign-in');
    expect(location.searchParams.get('next')).toBe('/disputes?status=open');
  });

  it.each(['CONSUMER', 'LOGISTICS'] as const)('turns a %s session back to sign in', async (scope) => {
    const response = await middleware(request('/queue', await sealed(scope)));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/sign-in');
    expect(location.searchParams.get('error')).toBe('wrong-scope');
    // And it names no other app: this host does not say where the visitor's account belongs.
    expect(location.origin).toBe('https://ops.komtru.com');
  });

  it('clears both cookies when it turns a session back', async () => {
    const response = await middleware(request('/queue', await sealed('CONSUMER')));
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.every((cookie) => /Max-Age=0/.test(cookie))).toBe(true);
  });

  it('refuses a session cookie it did not seal', async () => {
    const forged = await createSessionSealer('another-secret-that-is-also-32-chars').seal({
      scope: 'STAFF',
      expiresAt: Date.now() + 60_000,
    });
    expect((await middleware(request('/queue', forged))).status).toBe(307);
  });

  it('refuses a lapsed STAFF session', async () => {
    const lapsed = await sealed('STAFF', Date.now() - 1_000);
    expect((await middleware(request('/queue', lapsed))).status).toBe(307);
  });

  it('gates every section the sidebar names', async () => {
    const { SECTIONS } = await import('../src/shell/nav.js');
    for (const section of SECTIONS) {
      expect((await middleware(request(section.href))).status).toBe(307);
    }
  });
});

describe('the doors before a session', () => {
  it.each([
    '/sign-in',
    '/welcome',
    '/invite',
    '/invite?token=abc',
    '/api/invitation/sign-in',
    '/api/auth/login',
  ])('leaves %s open', async (path) => {
    expect(passes(await middleware(request(path)))).toBe(true);
  });

  it('does not open a path that only starts like a public one', async () => {
    expect((await middleware(request('/welcome-back'))).status).toBe(307);
    expect((await middleware(request('/invited'))).status).toBe(307);
    expect((await middleware(request('/api/invitations'))).status).toBe(307);
  });
});

describe('the matcher', () => {
  it('is the shared matcher, written out as a literal', () => {
    expect(matcher).toEqual([...KOMTRU_MATCHER]);
  });
});
