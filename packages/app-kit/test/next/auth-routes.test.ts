import type { SessionScope } from '@komtru/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';
import { readAppConfig, type AppConfig } from '../../src/config.js';
import { createAuthRouteHandlers, komtruAuthRoute } from '../../src/next/auth-routes.js';
import { createSessionSealer } from '../../src/session.js';

const sealer = createSessionSealer('a'.repeat(32));

const configFor = (scope: SessionScope): AppConfig =>
  readAppConfig(
    { appName: 'test-app', scope },
    {
      NEXT_PUBLIC_KOMTRU_APP_URL: 'https://app.komtru.com',
      NEXT_PUBLIC_KOMTRU_API_URL: 'https://api.komtru.com/v1',
    },
  );

const session = {
  accessToken: 'at-1',
  refreshToken: 'rt-1',
  scope: 'CONSUMER' as SessionScope,
  expiresIn: 600,
  expiresAt: 4_000_000_000_000,
};

interface Call {
  path: string;
  body: unknown;
}

/** A fetch double that records what the route handler asked the backend for. */
class Backend {
  calls: Call[] = [];
  private queue: { status: number; body: unknown; delayMs: number }[] = [];
  private failure: Error | undefined;

  reply(status: number, body: unknown): void {
    this.queue.push({ status, body, delayMs: 0 });
  }

  replyAfter(delayMs: number, status: number, body: unknown): void {
    this.queue.push({ status, body, delayMs });
  }

  fail(error: Error): void {
    this.failure = error;
  }

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : (input as Request).url);
    this.calls.push({
      path: url.pathname.replace(/^\/v1/, ''),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    if (this.failure) throw this.failure;
    const next = this.queue.shift() ?? { status: 200, body: session, delayMs: 0 };
    if (next.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, next.delayMs));
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

let backend: Backend;
let handlers: ReturnType<typeof createAuthRouteHandlers>;
let staffHandlers: ReturnType<typeof createAuthRouteHandlers>;

beforeEach(() => {
  backend = new Backend();
  handlers = createAuthRouteHandlers({ config: configFor('CONSUMER'), sealer, fetch: backend.fetch });
  staffHandlers = createAuthRouteHandlers({ config: configFor('STAFF'), sealer, fetch: backend.fetch });
});

const post = (body?: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.komtru.com/api/auth/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const cookiesOf = (response: Response) => response.headers.getSetCookie();

describe('login', () => {
  it('sets the refresh token as a cookie and keeps it out of the body', async () => {
    const response = await handlers.login(post({ identifier: 'a@b.c', password: 'x' }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('refreshToken');
    expect(body).toMatchObject({ accessToken: 'at-1', scope: 'CONSUMER' });
    expect(cookiesOf(response).join(';')).toContain('komtru_rt=rt-1');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('posts to the route the backend actually serves', async () => {
    await handlers.login(post({ identifier: 'a@b.c', password: 'x' }));
    expect(backend.calls[0]?.path).toBe('/auth/login');
  });

  it('passes a backend problem through with its status and code', async () => {
    backend.reply(401, { type: 'about:blank', code: 'INVALID_CREDENTIALS', title: 'Sign in failed' });
    const response = await handlers.login(post({ identifier: 'a@b.c', password: 'x' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(cookiesOf(response)).toEqual([]);
  });

  it("revokes the session it just created when the scope is not this app's", async () => {
    const response = await staffHandlers.login(post({ identifier: 'a@b.c', password: 'x' }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'WRONG_SCOPE' });
    expect(backend.calls.map((call) => call.path)).toEqual(['/auth/login', '/auth/logout']);
    expect(backend.calls[1]?.body).toMatchObject({ refreshToken: 'rt-1' });
    expect(cookiesOf(response)).toEqual([]);
  });

  it('refuses a body that is not a login', async () => {
    const response = await handlers.login(post({ identifier: 'a@b.c' }));
    expect(response.status).toBe(422);
    expect(backend.calls).toEqual([]);
  });

  it('refuses a response the backend should never have sent', async () => {
    backend.reply(200, { accessToken: 'at-1' });
    expect((await handlers.login(post({ identifier: 'a@b.c', password: 'x' }))).status).toBe(502);
  });
});

describe('refresh', () => {
  it('rotates both cookies', async () => {
    backend.reply(200, { ...session, accessToken: 'at-2', refreshToken: 'rt-2' });
    const response = await handlers.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' }));
    expect(backend.calls[0]).toMatchObject({ path: '/auth/refresh', body: { refreshToken: 'rt-1' } });
    expect(cookiesOf(response).join(';')).toContain('komtru_rt=rt-2');
    expect(await response.json()).toMatchObject({ accessToken: 'at-2' });
  });

  it('answers 401 with no cookie at all, which is what ends the session client-side', async () => {
    const response = await handlers.refresh(post());
    expect(response.status).toBe(401);
    expect(backend.calls).toEqual([]);
  });

  it('ends the session when the backend says the credential is gone', async () => {
    backend.reply(401, { code: 'SESSION_REVOKED' });
    const response = await handlers.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' }));
    expect(response.status).toBe(401);
    expect(cookiesOf(response)).toHaveLength(2);
    expect(cookiesOf(response).every((cookie) => /Max-Age=0/.test(cookie))).toBe(true);
  });

  it('does not sign anyone out because the backend hiccupped', async () => {
    backend.reply(503, { code: 'SERVICE_UNAVAILABLE' });
    const response = await handlers.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' }));
    expect(response.status).toBe(503);
    expect(cookiesOf(response)).toEqual([]);
  });

  it('does not sign anyone out when the backend cannot be reached at all', async () => {
    backend.fail(new TypeError('fetch failed'));
    const response = await handlers.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' }));
    expect(response.status).toBe(502);
    expect(cookiesOf(response)).toEqual([]);
  });

  it('rotates once for two tabs that arrive with the same token', async () => {
    backend.replyAfter(20, 200, { ...session, accessToken: 'at-2', refreshToken: 'rt-2' });
    const [a, b] = await Promise.all([
      handlers.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' })),
      handlers.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' })),
    ]);
    expect(backend.calls).toHaveLength(1);
    expect(await a.json()).toEqual(await b.json());
    expect(cookiesOf(a)).toEqual(cookiesOf(b));
  });

  it('mints a fresh rotation once the first has settled', async () => {
    await handlers.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' }));
    await handlers.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' }));
    expect(backend.calls).toHaveLength(2);
  });

  it("does not share one tab's rotation with another tab's different token", async () => {
    backend.replyAfter(20, 200, { ...session, refreshToken: 'rt-2' });
    backend.replyAfter(20, 200, { ...session, refreshToken: 'rt-3' });
    await Promise.all([
      handlers.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' })),
      handlers.refresh(post(undefined, { cookie: 'komtru_rt=other' })),
    ]);
    expect(backend.calls).toHaveLength(2);
  });
});

describe('logout', () => {
  it('revokes the session and clears both cookies', async () => {
    backend.reply(200, { ok: true });
    const response = await handlers.logout(post({ allDevices: false }, { cookie: 'komtru_rt=rt-1' }));
    expect(backend.calls[0]).toMatchObject({
      path: '/auth/logout',
      body: { refreshToken: 'rt-1', allDevices: false },
    });
    expect(response.status).toBe(200);
    expect(cookiesOf(response).every((cookie) => /Max-Age=0/.test(cookie))).toBe(true);
  });

  it('signs out locally even when the backend cannot be reached', async () => {
    backend.fail(new TypeError('fetch failed'));
    const response = await handlers.logout(post({ allDevices: false }, { cookie: 'komtru_rt=rt-1' }));
    expect(response.status).toBe(200);
    expect(cookiesOf(response).every((cookie) => /Max-Age=0/.test(cookie))).toBe(true);
  });

  it('signs out with no cookie to revoke', async () => {
    const response = await handlers.logout(post({ allDevices: false }));
    expect(response.status).toBe(200);
    expect(backend.calls).toEqual([]);
  });

  it('forwards allDevices so sign out everywhere really does', async () => {
    backend.reply(200, { ok: true });
    await handlers.logout(post({ allDevices: true }, { cookie: 'komtru_rt=rt-1' }));
    expect(backend.calls[0]?.body).toMatchObject({ allDevices: true });
  });
});

describe('komtruAuthRoute', () => {
  const route = () => komtruAuthRoute({ config: configFor('CONSUMER'), sealer, fetch: backend.fetch });

  it('serves the three actions from one catch-all', async () => {
    expect((await route()(post(), { params: Promise.resolve({ action: ['logout'] }) })).status).toBe(200);
  });

  it('404s anything else', async () => {
    expect((await route()(post(), { params: Promise.resolve({ action: ['steal'] }) })).status).toBe(404);
    expect((await route()(post(), { params: Promise.resolve({ action: ['login', 'extra'] }) })).status).toBe(
      404,
    );
  });
});
