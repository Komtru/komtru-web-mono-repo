// The real middleware over real `NextRequest`s (T-160): LOGISTICS passes, every other scope is turned
// back at the door, and sign-in and the auth handlers stay open.
import { createSessionSealer } from '@komtru/app-kit';
import { KOMTRU_MATCHER } from '@komtru/app-kit/next';
import type { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';

const SECRET = 'test-secret-that-is-long-enough-32';

const ENV = {
  NEXT_PUBLIC_KOMTRU_APP_URL: 'https://logistics.komtru.com',
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

const request = (path: string, cookie?: string) =>
  new Request_(new URL(path, 'http://localhost:3003'), {
    headers: cookie === undefined ? {} : { cookie: `komtru_session=${cookie}` },
  });

const sealed = async (scope: 'CONSUMER' | 'STAFF' | 'LOGISTICS', expiresAt = Date.now() + 60_000) =>
  createSessionSealer(SECRET).seal({ scope, expiresAt });

const passes = (response: { status: number; headers: Headers }) =>
  response.status === 200 && response.headers.get('x-middleware-next') === '1';

describe('LOGISTICS scope', () => {
  it('lets a LOGISTICS session through to a portal page', async () => {
    expect(passes(await middleware(request('/team', await sealed('LOGISTICS'))))).toBe(true);
  });

  it('sends a visitor with no session to sign in, remembering where they were going', async () => {
    const response = await middleware(request('/team'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://logistics.komtru.com');
    expect(location.pathname).toBe('/sign-in');
    expect(location.searchParams.get('next')).toBe('/team');
  });

  it.each(['CONSUMER', 'STAFF'] as const)('turns a %s session back to sign in', async (scope) => {
    const response = await middleware(request('/team', await sealed(scope)));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/sign-in');
    expect(location.searchParams.get('error')).toBe('wrong-scope');
    expect(location.origin).toBe('https://logistics.komtru.com');
  });

  it('refuses a lapsed session and one it did not seal', async () => {
    expect((await middleware(request('/team', await sealed('LOGISTICS', Date.now() - 1_000)))).status).toBe(
      307,
    );
    const forged = await createSessionSealer('another-secret-that-is-also-32-chars').seal({
      scope: 'LOGISTICS',
      expiresAt: Date.now() + 60_000,
    });
    expect((await middleware(request('/team', forged))).status).toBe(307);
  });

  it('gates every section the rail names', async () => {
    const { SECTIONS } = await import('../src/shell/nav.js');
    for (const section of SECTIONS) expect((await middleware(request(section.href))).status).toBe(307);
  });

  it('leaves sign-in and the auth handlers open, and nothing else', async () => {
    expect(passes(await middleware(request('/sign-in')))).toBe(true);
    expect(passes(await middleware(request('/api/auth/login')))).toBe(true);
    expect((await middleware(request('/accept-invite'))).status).toBe(307);
  });

  it('uses the shared matcher, written out as a literal', () => {
    expect(matcher).toEqual([...KOMTRU_MATCHER]);
  });
});
