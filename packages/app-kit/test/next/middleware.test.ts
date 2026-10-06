import { SESSION_SCOPES, type SessionScope } from '@komtru/shared-types';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { readAppConfig, type AppSpec } from '../../src/config.js';
import { createKomtruMiddleware, KOMTRU_MATCHER } from '../../src/next/middleware.js';
import { createSessionSealer, SESSION_COOKIE } from '../../src/session.js';

const sealer = createSessionSealer('a'.repeat(32));

/** The four apps and the scope each one's middleware requires (design §7.3, MVP epics 13–16). */
const APPS = [
  { app: 'web-app-ui', scope: 'CONSUMER', origin: 'https://app.komtru.com' },
  { app: 'operations-app', scope: 'STAFF', origin: 'https://ops.komtru.com' },
  { app: 'logistics-ops', scope: 'LOGISTICS', origin: 'https://logistics.komtru.com' },
  { app: 'park-agent-app', scope: 'LOGISTICS', origin: 'https://park.komtru.com' },
] as const;

const configFor = (scope: SessionScope, extra: Partial<AppSpec> = {}, elsewhere?: string) =>
  readAppConfig(
    { appName: 'test-app', scope, ...extra },
    {
      NEXT_PUBLIC_KOMTRU_APP_URL: 'https://app.komtru.com',
      NEXT_PUBLIC_KOMTRU_API_URL: 'https://api.komtru.com/v1',
      ...(elsewhere === undefined ? {} : { NEXT_PUBLIC_ELSEWHERE: elsewhere }),
    },
  );

const sealed = (scope: SessionScope) => sealer.seal({ scope, expiresAt: 4_000_000_000_000 });

interface RunOptions {
  elsewhereUrl?: string;
  now?: () => number;
  publicPaths?: readonly string[];
}

const run = async (
  required: SessionScope,
  cookie: string | undefined,
  path: string,
  options: RunOptions = {},
) => {
  const config = configFor(
    required,
    options.elsewhereUrl === undefined ? {} : { elsewhereUrlEnv: 'NEXT_PUBLIC_ELSEWHERE' },
    options.elsewhereUrl,
  );
  const middleware = createKomtruMiddleware({
    config,
    sealer,
    ...(options.now ? { now: options.now } : {}),
    ...(options.publicPaths ? { publicPaths: options.publicPaths } : {}),
  });
  // Concatenated, not `new URL(path, origin)`: the two-argument form resolves `//evil.com/x`
  // against the base *before* middleware sees it, which is exactly the normalisation under test.
  const request = new NextRequest(new URL(`https://app.komtru.com${path}`), {
    headers: cookie === undefined ? {} : { cookie: `${SESSION_COOKIE}=${cookie}` },
  });
  return middleware(request);
};

const passedThrough = (response: Response) => response.headers.get('x-middleware-next') === '1';

describe.each(APPS)('$app middleware', ({ scope: required }) => {
  it.each(SESSION_SCOPES)('a %s session', async (held) => {
    const response = await run(required, await sealed(held), '/trades');
    if (held === required) {
      expect(passedThrough(response)).toBe(true);
    } else {
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get('location')!).pathname).toBe('/sign-in');
    }
  });
});

describe('createKomtruMiddleware', () => {
  it('rejects a consumer token at every app that is not the consumer app', async () => {
    for (const { app, scope } of APPS.filter((entry) => entry.scope !== 'CONSUMER')) {
      const response = await run(scope, await sealed('CONSUMER'), '/queue');
      expect(response.status, app).toBe(307);
    }
  });

  it('sends a wrong-scope session to the app it belongs to when one is configured', async () => {
    const response = await run('LOGISTICS', await sealed('CONSUMER'), '/parcels', {
      elsewhereUrl: 'https://app.komtru.com',
    });
    expect(response.headers.get('location')).toBe('https://app.komtru.com/');
  });

  it('says why when it sends a wrong-scope session to its own sign-in', async () => {
    const location = new URL(
      (await run('STAFF', await sealed('CONSUMER'), '/queue')).headers.get('location')!,
    );
    expect(location.searchParams.get('error')).toBe('wrong-scope');
  });

  it('clears both cookies on every rejection, so the next navigation is not rejected twice', async () => {
    const response = await run('STAFF', await sealed('CONSUMER'), '/queue');
    const set = response.headers.getSetCookie();
    expect(set.filter((c) => c.startsWith('komtru_rt=') || c.startsWith('komtru_session='))).toHaveLength(2);
    for (const cookie of set) expect(cookie).toMatch(/Max-Age=0/);
  });

  it('remembers where the visitor was going', async () => {
    const response = await run('CONSUMER', undefined, '/trades/KMT-1?tab=evidence');
    expect(new URL(response.headers.get('location')!).searchParams.get('next')).toBe(
      '/trades/KMT-1?tab=evidence',
    );
  });

  it.each(['/sign-in', '/api/auth/refresh', '/_next/static/chunk.js', '/favicon.ico', '/logo.svg'])(
    'lets %s through with no session',
    async (path) => {
      expect(passedThrough(await run('CONSUMER', undefined, path))).toBe(true);
    },
  );

  it('lets a path the app declares public through', async () => {
    expect(
      passedThrough(await run('CONSUMER', undefined, '/passport/zaza', { publicPaths: ['/passport'] })),
    ).toBe(true);
  });

  it('does not treat a path that merely starts with the same characters as public', async () => {
    const response = await run('CONSUMER', undefined, '/passportage', { publicPaths: ['/passport'] });
    expect(response.status).toBe(307);
  });

  it('does not throw on a cookie someone made up', async () => {
    const response = await run('CONSUMER', 'v1.notbase64.notasignature', '/trades');
    expect(response.status).toBe(307);
  });

  it('redirects an expired hint rather than trusting it', async () => {
    const stale = await sealer.seal({ scope: 'CONSUMER', expiresAt: 1_000 });
    expect((await run('CONSUMER', stale, '/trades', { now: () => 2_000 })).status).toBe(307);
  });

  it.each(['/trades/KMT-1.2', '/u/jane.doe', '/settings/v1.5', '/a.b/c'])(
    'guards %s, which is a page and not an asset',
    async (path) => {
      // `.*\\..*` would exclude a dot anywhere, not only a trailing extension, and every protected
      // page whose URL carries a username, a version or a decimal would be served with no check.
      const [matcher] = KOMTRU_MATCHER;
      expect(new RegExp(`^${matcher}$`).test(path), `matcher skips ${path}`).toBe(true);
      expect((await run('CONSUMER', undefined, path)).status).toBe(307);
    },
  );

  it.each(['/styles.css', '/chunk.js', '/logo.svg', '/favicon.ico', '/fonts/inter.woff2'])(
    'lets the asset %s through, by the same rule the matcher uses',
    async (path) => {
      const [matcher] = KOMTRU_MATCHER;
      expect(new RegExp(`^${matcher}$`).test(path), `matcher guards ${path}`).toBe(false);
      expect(passedThrough(await run('CONSUMER', undefined, path))).toBe(true);
    },
  );

  it.each(['//evil.com/x', '/\\evil.com', '//evil.com'])(
    'does not hand the sign-in page %j to redirect to',
    async (path) => {
      // `new URL('//evil.com/x', origin)` resolves to https://evil.com/x, so a sign-in screen that
      // does `router.replace(next)` would be an open redirect. Do not emit the value at all.
      const location = new URL((await run('CONSUMER', undefined, path)).headers.get('location')!);
      expect(location.searchParams.get('next')).toBeNull();
    },
  );

  it('exports a matcher that excludes the static paths it also guards against', () => {
    const [matcher] = KOMTRU_MATCHER;
    const pattern = new RegExp(`^${matcher}$`);
    expect(pattern.test('/_next/static/chunk.js')).toBe(false);
    expect(pattern.test('/favicon.ico')).toBe(false);
    expect(pattern.test('/trades')).toBe(true);
  });
});
