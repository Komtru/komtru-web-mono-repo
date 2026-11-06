import type { SessionScope } from '@komtru/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';
import { readAppConfig, type AppConfig } from '../../src/config.js';
import { createAuthRouteHandlers, komtruAuthRoute } from '../../src/next/auth-routes.js';
import { createMemoryRefreshStore } from '../../src/next/auth-guards.js';
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
  headers: Record<string, string>;
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
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    if (this.failure) throw this.failure;
    const next = this.queue.shift() ?? { status: 200, body: session, delayMs: 0 };
    if (next.delayMs > 0) {
      // Honours the caller's AbortSignal, the way a real fetch does, so a timeout test is a test.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, next.delayMs);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }
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
    headers: { 'content-type': 'application/json', origin: 'https://app.komtru.com', ...headers },
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

  it('refuses a truncated body with a 422 rather than a 500', async () => {
    const response = await handlers.login(
      new Request('https://app.komtru.com/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://app.komtru.com' },
        body: '{"identifier":"a@b.c","passw',
      }),
    );
    expect(response.status).toBe(422);
    expect(backend.calls).toEqual([]);
  });

  it('hands the browser only the fields it is meant to see', async () => {
    backend.reply(200, { ...session, nextStep: 'NONE', user: { id: 'u1' }, internalSecret: 'leak' });
    const body = (await (
      await handlers.login(post({ identifier: 'a@b.c', password: 'x' }))
    ).json()) as Record<string, unknown>;
    // An allowlist, not a denylist: a field the backend adds later must not reach the browser by
    // default on a platform whose responses carry credentials.
    expect(Object.keys(body).sort()).toEqual([
      'accessToken',
      'expiresAt',
      'expiresIn',
      'nextStep',
      'scope',
      'user',
    ]);
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

  it('still clears the cookies when the body is truncated', async () => {
    // A flaky mobile connection truncates a request. Throwing here would leave the person signed in
    // on a shared phone, looking at a 500.
    const response = await handlers.logout(
      new Request('https://app.komtru.com/api/auth/logout', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://app.komtru.com',
          cookie: 'komtru_rt=rt-1',
        },
        body: '{',
      }),
    );
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

describe('the backend calls', () => {
  it('give up rather than hold a request open against a backend that never answers', async () => {
    const impatient = createAuthRouteHandlers({
      config: configFor('CONSUMER'),
      sealer,
      fetch: backend.fetch,
      timeoutMs: 20,
    });
    backend.replyAfter(5_000, 200, session);
    const response = await impatient.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' }));
    expect(response.status).toBe(502);
    // And the rotation is not pinned: the next tab gets its own attempt rather than the dead promise.
    backend.reply(200, session);
    expect((await impatient.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' }))).status).toBe(200);
  });

  it("decides Secure from the app's own origin, not from the request's Host header", async () => {
    // Behind a TLS-terminating proxy that forwards to http://localhost and rewrites Host, a
    // request-derived answer drops Secure from a production cookie.
    const https = createAuthRouteHandlers({
      config: { ...configFor('CONSUMER'), appUrl: 'https://app.komtru.com' },
      sealer,
      fetch: backend.fetch,
    });
    const response = await https.login(
      new Request('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://app.komtru.com' },
        body: JSON.stringify({ identifier: 'a@b.c', password: 'x' }),
      }),
    );
    expect(cookiesOf(response).every((cookie) => /Secure/.test(cookie))).toBe(true);
  });

  it('does not share a rotation between two apps in one process', async () => {
    const other = createAuthRouteHandlers({
      config: { ...configFor('CONSUMER'), appName: 'other-app' },
      sealer,
      fetch: backend.fetch,
    });
    backend.replyAfter(20, 200, { ...session, refreshToken: 'rt-2' });
    backend.replyAfter(20, 200, { ...session, refreshToken: 'rt-3' });
    await Promise.all([
      handlers.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' })),
      other.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' })),
    ]);
    expect(backend.calls).toHaveLength(2);
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

const challenge = {
  mfaRequired: true,
  mfaToken: 'cid.secret',
  expiresAt: 4_000_000_000_000,
  factors: [{ id: '4c8f6a2e-1b0d-4f5a-9e3c-7d2b1a0c9e88', type: 'TOTP', hint: null, isDefault: true }],
};

const staffSession = { ...session, scope: 'STAFF' as SessionScope };

const factorId = '4c8f6a2e-1b0d-4f5a-9e3c-7d2b1a0c9e88';

describe('a login that owes a second factor', () => {
  it('passes the challenge through with no cookie, because it carries no credential', async () => {
    backend.reply(200, challenge);
    const response = await staffHandlers.login(post({ identifier: 'a@b.c', password: 'x' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(challenge);
    expect(cookiesOf(response)).toEqual([]);
  });

  it('refuses a challenge that carries a token beside it', async () => {
    backend.reply(200, { ...challenge, accessToken: 'at-1' });
    const response = await staffHandlers.login(post({ identifier: 'a@b.c', password: 'x' }));
    expect(response.status).toBe(502);
  });

  it('hands the browser only the challenge fields it is meant to see', async () => {
    backend.reply(200, { ...challenge, internal: 'leak' });
    const body = (await (
      await staffHandlers.login(post({ identifier: 'a@b.c', password: 'x' }))
    ).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'factors', 'mfaRequired', 'mfaToken']);
  });
});

describe('mfa', () => {
  const verify = (body: unknown = { mfaToken: 'cid.secret', factorId, code: '123456' }) => post(body);

  it('posts to the path it was given and opens the session like a login', async () => {
    const staff = createAuthRouteHandlers({
      config: configFor('STAFF'),
      sealer,
      fetch: backend.fetch,
      mfaVerifyPath: '/auth/staff/mfa/verify',
    });
    backend.reply(200, staffSession);
    const response = await staff.mfa(verify());
    expect(backend.calls[0]).toMatchObject({
      path: '/auth/staff/mfa/verify',
      body: { mfaToken: 'cid.secret', factorId, code: '123456' },
    });
    expect(response.status).toBe(200);
    expect(cookiesOf(response).join(';')).toContain('komtru_rt=rt-1');
    expect(await response.json()).not.toHaveProperty('refreshToken');
  });

  it('defaults to the consumer route', async () => {
    await handlers.mfa(verify());
    expect(backend.calls[0]?.path).toBe('/auth/mfa/verify');
  });

  it("revokes a session that is not this app's scope", async () => {
    backend.reply(200, session);
    const response = await staffHandlers.mfa(verify());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'WRONG_SCOPE' });
    expect(backend.calls.map((call) => call.path)).toEqual(['/auth/mfa/verify', '/auth/logout']);
  });

  it('passes a wrong code through with the attempts left', async () => {
    backend.reply(401, { code: 'INVALID_CREDENTIALS', attemptsRemaining: 3 });
    const response = await staffHandlers.mfa(verify());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ attemptsRemaining: 3 });
    expect(cookiesOf(response)).toEqual([]);
  });

  it('refuses a body that is not a second-factor answer', async () => {
    const response = await staffHandlers.mfa(verify({ mfaToken: 'cid.secret' }));
    expect(response.status).toBe(422);
    expect(backend.calls).toEqual([]);
  });
});

describe('mfa-challenge', () => {
  it('asks the backend to send the code and answers with how to present it', async () => {
    const body = { kind: 'CODE', challengeId: null, maskedDestination: '+23480•••5567', delivered: true };
    backend.reply(200, body);
    const response = await staffHandlers.mfaChallenge(post({ mfaToken: 'cid.secret', factorId }));
    expect(backend.calls[0]).toMatchObject({ path: '/auth/mfa/challenge' });
    expect(await response.json()).toEqual(body);
    expect(cookiesOf(response)).toEqual([]);
  });

  it('refuses a body without a factor', async () => {
    expect((await staffHandlers.mfaChallenge(post({ mfaToken: 'cid.secret' }))).status).toBe(422);
  });
});

describe('komtruAuthRoute, with the second step', () => {
  const route = () => komtruAuthRoute({ config: configFor('STAFF'), sealer, fetch: backend.fetch });

  it('serves mfa and mfa-challenge too', async () => {
    backend.reply(200, staffSession);
    const verified = await route()(post({ mfaToken: 'cid.secret', factorId, code: '123456' }), {
      params: Promise.resolve({ action: ['mfa'] }),
    });
    expect(verified.status).toBe(200);
    const challenged = await route()(post({ mfaToken: 'cid.secret', factorId }), {
      params: Promise.resolve({ action: ['mfa-challenge'] }),
    });
    expect(challenged.status).toBe(200);
  });
});

describe('the browser-only guard', () => {
  const bare = (headers: Record<string, string>, body: unknown = { identifier: 'a@b.c', password: 'x' }) =>
    new Request('https://app.komtru.com/api/auth/x', { method: 'POST', headers, body: JSON.stringify(body) });

  it.each([
    ['login', { identifier: 'a@b.c', password: 'x' }],
    ['mfa', { mfaToken: 'cid.secret', factorId, code: '123456' }],
    ['mfaChallenge', { mfaToken: 'cid.secret', factorId }],
    ['logout', { allDevices: false }],
    ['release', {}],
  ] as const)('refuses %s from another origin, from a form post and with no origin', async (name, body) => {
    const h = createAuthRouteHandlers({
      config: configFor('CONSUMER'),
      sealer,
      fetch: backend.fetch,
      tokenMode: { store: createMemoryRefreshStore({ ttlMs: 1000 }) },
    });
    const json = { 'content-type': 'application/json' };
    expect((await h[name](bare({ ...json, origin: 'https://evil.com' }, body))).status).toBe(403);
    expect(
      (await h[name](bare({ 'content-type': 'text/plain', origin: 'https://app.komtru.com' }, body))).status,
    ).toBe(403);
    expect((await h[name](bare(json, body))).status).toBe(403);
    expect(backend.calls).toEqual([]);
  });

  it('accepts a same-origin referer when the browser sent no origin', async () => {
    const response = await handlers.login(
      bare({ 'content-type': 'application/json', referer: 'https://app.komtru.com/sign-in' }),
    );
    expect(response.status).toBe(200);
  });

  it('does not clear cookies for a refused logout', async () => {
    const response = await handlers.logout(
      bare({ 'content-type': 'text/plain', cookie: 'komtru_rt=rt-1' }, {}),
    );
    expect(response.status).toBe(403);
    expect(cookiesOf(response)).toEqual([]);
  });
});

describe('the client the backend sees', () => {
  it('forwards the chain and user agent on login, mfa, challenge and logout', async () => {
    const via = { 'x-forwarded-for': '203.0.113.7', 'user-agent': 'Mozilla/5.0' };
    await handlers.login(post({ identifier: 'a@b.c', password: 'x' }, via));
    await handlers.mfa(post({ mfaToken: 'cid.secret', factorId, code: '123456' }, via));
    await handlers.mfaChallenge(post({ mfaToken: 'cid.secret', factorId }, via));
    await handlers.logout(post({ allDevices: false }, { ...via, cookie: 'komtru_rt=rt-1' }));
    expect(backend.calls).toHaveLength(4);
    for (const call of backend.calls) {
      expect(call.headers['x-forwarded-for']).toBe('203.0.113.7');
      expect(call.headers['user-agent']).toBe('Mozilla/5.0');
    }
  });

  it('forwards it on the revoke it makes for a wrong-scope session too', async () => {
    await staffHandlers.login(
      post({ identifier: 'a@b.c', password: 'x' }, { 'x-forwarded-for': '203.0.113.7' }),
    );
    expect(backend.calls[1]?.path).toBe('/auth/logout');
    expect(backend.calls[1]?.headers['x-forwarded-for']).toBe('203.0.113.7');
  });
});

describe('the limiter', () => {
  const via = (ip: string) => ({ 'x-forwarded-for': ip });

  it('answers 429 with a wait once an identifier has spent its points, whatever the address', async () => {
    for (let n = 0; n < 5; n += 1) {
      await handlers.login(post({ identifier: 'a@b.c', password: 'x' }, via(`10.0.0.${String(n)}`)));
    }
    const response = await handlers.login(post({ identifier: ' A@B.C ', password: 'x' }, via('10.0.0.99')));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(backend.calls).toHaveLength(5);
  });

  it('answers 429 once an address has spent its points, whatever the identifier', async () => {
    for (let n = 0; n < 20; n += 1) {
      await handlers.login(post({ identifier: `user${String(n)}@b.c`, password: 'x' }, via('10.0.0.1')));
    }
    const response = await handlers.login(post({ identifier: 'fresh@b.c', password: 'x' }, via('10.0.0.1')));
    expect(response.status).toBe(429);
    expect(
      (await handlers.login(post({ identifier: 'fresh@b.c', password: 'x' }, via('10.0.0.2')))).status,
    ).toBe(200);
  });

  it('limits the second step per challenge, not per code guess', async () => {
    const body = { mfaToken: 'cid.secret', factorId, code: '111111' };
    for (let n = 0; n < 8; n += 1) await handlers.mfa(post(body, via('10.0.0.1')));
    expect((await handlers.mfa(post({ ...body, mfaToken: 'cid2.secret' }, via('10.0.0.1')))).status).toBe(
      200,
    );
    expect((await handlers.mfa(post({ ...body, code: '222222' }, via('10.0.0.3')))).status).toBe(429);
  });

  it('limits mfa-challenge too, so a code cannot be sent in a loop', async () => {
    const body = { mfaToken: 'cid.secret', factorId };
    for (let n = 0; n < 5; n += 1) await handlers.mfaChallenge(post(body, via('10.0.0.1')));
    expect((await handlers.mfaChallenge(post(body, via('10.0.0.1')))).status).toBe(429);
  });

  it('can be turned off, and starts a fresh window after a minute', async () => {
    let now = 0;
    const timed = createAuthRouteHandlers({
      config: configFor('CONSUMER'),
      sealer,
      fetch: backend.fetch,
      now: () => now,
    });
    for (let n = 0; n < 5; n += 1) await timed.login(post({ identifier: 'a@b.c', password: 'x' }));
    expect((await timed.login(post({ identifier: 'a@b.c', password: 'x' }))).status).toBe(429);
    now = 61_000;
    expect((await timed.login(post({ identifier: 'a@b.c', password: 'x' }))).status).toBe(200);

    const open = createAuthRouteHandlers({
      config: configFor('CONSUMER'),
      sealer,
      fetch: backend.fetch,
      limits: false,
    });
    for (let n = 0; n < 30; n += 1) await open.login(post({ identifier: 'a@b.c', password: 'x' }));
    expect((await open.login(post({ identifier: 'a@b.c', password: 'x' }))).status).toBe(200);
  });
});

describe('token mode', () => {
  const store = () => createMemoryRefreshStore({ ttlMs: 60_000 });
  const consumer = (s = store(), extra: Partial<Parameters<typeof createAuthRouteHandlers>[0]> = {}) =>
    createAuthRouteHandlers({
      config: configFor('CONSUMER'),
      sealer,
      fetch: backend.fetch,
      tokenMode: { store: s },
      ...extra,
    });

  it('returns the access token, sets no cookie and keeps the refresh token to itself', async () => {
    const s = store();
    backend.reply(200, { ...session, nextStep: 'NONE', user: { id: 'u1' } });
    const response = await consumer(s).login(post({ identifier: 'a@b.c', password: 'x' }));
    expect(response.status).toBe(200);
    expect(cookiesOf(response)).toEqual([]);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['accessToken', 'expiresAt', 'expiresIn', 'scope']);
    expect(JSON.stringify(body)).not.toContain('rt-1');
    expect(s.take('at-1')).toBe('rt-1');
  });

  it('passes a second-factor challenge through, and opens the token after it', async () => {
    const s = store();
    backend.reply(200, challenge);
    const first = await consumer(s).login(post({ identifier: 'a@b.c', password: 'x' }));
    expect(await first.json()).toEqual(challenge);
    expect(s.sweep()).toEqual([]);

    backend.reply(200, session);
    const second = await consumer(s).mfa(post({ mfaToken: 'cid.secret', factorId, code: '123456' }));
    expect(cookiesOf(second)).toEqual([]);
    expect(await second.json()).toMatchObject({ accessToken: 'at-1' });
    expect(s.take('at-1')).toBe('rt-1');
  });

  it('revokes the session on release, once, and answers the same for an unknown token', async () => {
    const s = store();
    s.put('at-1', 'rt-1');
    const h = consumer(s);
    const release = (token: string) =>
      h.release(post({}, { authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.7' }));
    expect((await release('at-1')).status).toBe(200);
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0]).toMatchObject({
      path: '/auth/logout',
      body: { refreshToken: 'rt-1', allDevices: false },
    });
    expect(backend.calls[0]?.headers['x-forwarded-for']).toBe('203.0.113.7');

    expect(await (await release('at-1')).json()).toEqual({ ok: true });
    expect(await (await release('nope')).json()).toEqual({ ok: true });
    expect(backend.calls).toHaveLength(1);
  });

  it('revokes what an abandoned page left behind, on the next sign-in', async () => {
    let now = 0;
    const s = createMemoryRefreshStore({ ttlMs: 1000, now: () => now });
    s.put('at-old', 'rt-old');
    now = 5000;
    await consumer(s, { now: () => now }).login(post({ identifier: 'a@b.c', password: 'x' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(backend.calls.map((call) => call.body)).toContainEqual({
      refreshToken: 'rt-old',
      allDevices: false,
    });
  });

  it('refuses a session that is not the scope it was built for', async () => {
    const response = await consumer(store(), { config: configFor('STAFF') }).login(
      post({ identifier: 'a@b.c', password: 'x' }),
    );
    expect(response.status).toBe(403);
  });
});
