import { createAuthRouteHandlers, createMemoryRefreshStore } from '@komtru/app-kit/next';
import { createSessionSealer, readAppConfig } from '@komtru/app-kit';
import { describe, expect, it } from 'vitest';
import { appSpec } from '../src/app-config';
import { createInvitationRoute } from '../src/auth/invitation-route';

const config = readAppConfig(appSpec, {
  NEXT_PUBLIC_KOMTRU_APP_URL: 'https://ops.komtru.com',
  NEXT_PUBLIC_KOMTRU_API_URL: 'https://api.komtru.com/v1',
});
const ORIGIN = 'https://ops.komtru.com';
const TOKEN = 't'.repeat(40);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const session = {
  accessToken: 'at-1',
  refreshToken: 'rt-1',
  scope: 'CONSUMER',
  expiresIn: 600,
  expiresAt: 4_000_000_000_000,
};
const challenge = {
  mfaRequired: true,
  mfaToken: 'cid.secret',
  expiresAt: 4_000_000_000_000,
  factors: [{ id: '0190b0a0-0000-7000-8000-000000000001', type: 'TOTP', hint: null, isDefault: true }],
};

const setup = (reply: () => Response = () => json(session)) => {
  const calls: { url: string; body: unknown; headers: Headers }[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      headers: new Headers(init?.headers),
    });
    return Promise.resolve(reply());
  }) as unknown as typeof fetch;
  const store = createMemoryRefreshStore({ ttlMs: 60_000 });
  const route = createInvitationRoute({
    appOrigin: ORIGIN,
    handlers: createAuthRouteHandlers({
      config: { ...config, scope: 'CONSUMER' },
      sealer: createSessionSealer('a'.repeat(32)),
      fetch: fetchImpl,
      tokenMode: { store },
    }),
  });
  return { route, calls, store };
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/invitation/x`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });

const login = { identifier: 'amina@komtru.com', password: 'pw' };

describe('sign-in', () => {
  it('needs an invitation token, and a plausible one', async () => {
    const { route, calls } = setup();
    for (const body of [
      login,
      { ...login, invitationToken: '' },
      { ...login, invitationToken: 'short' },
      { ...login, invitationToken: 'has a space in it, twenty chars+' },
    ]) {
      const response = await route(post(body), ['sign-in']);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'INVITATION_TOKEN_REQUIRED' });
    }
    expect(calls).toEqual([]);
  });

  it('refuses a cross-site request before it says anything about tokens', async () => {
    const { route } = setup();
    expect((await route(post(login, { origin: 'https://evil.com' }), ['sign-in'])).status).toBe(403);
  });

  it('signs the consumer in against the consumer route, with the real client, and returns only a token', async () => {
    const { route, calls, store } = setup();
    const response = await route(
      post(
        { ...login, invitationToken: TOKEN },
        { 'x-forwarded-for': '203.0.113.7', 'user-agent': 'Mozilla/5.0' },
      ),
      ['sign-in'],
    );
    expect(calls[0]?.url).toBe('https://api.komtru.com/v1/auth/login');
    expect(calls[0]?.body).toEqual(login);
    expect(calls[0]?.headers.get('x-forwarded-for')).toBe('203.0.113.7');
    expect(calls[0]?.headers.get('user-agent')).toBe('Mozilla/5.0');
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.json()).toEqual({
      accessToken: 'at-1',
      scope: 'CONSUMER',
      expiresIn: 600,
      expiresAt: 4_000_000_000_000,
    });
    expect(store.take('at-1')).toBe('rt-1');
  });

  it('passes a second-factor challenge through instead of telling anyone to switch it off', async () => {
    const { route } = setup(() => json(challenge));
    const response = await route(post({ ...login, invitationToken: TOKEN }), ['sign-in']);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(challenge);
  });

  it('refuses a challenge that arrives beside a token', async () => {
    const { route } = setup(() => json({ ...challenge, accessToken: 'at-1' }));
    expect((await route(post({ ...login, invitationToken: TOKEN }), ['sign-in'])).status).toBe(502);
  });

  it('refuses a session that is not a consumer one, and revokes it', async () => {
    const { route, calls } = setup(() => json({ ...session, scope: 'STAFF' }));
    expect((await route(post({ ...login, invitationToken: TOKEN }), ['sign-in'])).status).toBe(403);
    expect(calls.map((call) => call.url.split('/v1')[1])).toEqual(['/auth/login', '/auth/logout']);
  });

  it('is throttled', async () => {
    const { route } = setup();
    let last = 0;
    for (let n = 0; n < 6; n += 1)
      last = (await route(post({ ...login, invitationToken: TOKEN }), ['sign-in'])).status;
    expect(last).toBe(429);
  });
});

describe('mfa, mfa-challenge and release', () => {
  const factorId = '0190b0a0-0000-7000-8000-000000000001';

  it('verify against the consumer second-factor route and return a token', async () => {
    const { route, calls, store } = setup();
    const response = await route(post({ mfaToken: 'cid.secret', factorId, code: '123456' }), ['mfa']);
    expect(calls[0]?.url).toBe('https://api.komtru.com/v1/auth/mfa/verify');
    expect(await response.json()).toMatchObject({ accessToken: 'at-1' });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(store.take('at-1')).toBe('rt-1');
  });

  it('ask for the code on the consumer challenge route', async () => {
    const { route, calls } = setup(() =>
      json({ kind: 'CODE', challengeId: null, maskedDestination: 'a•••@b.c', delivered: true }),
    );
    expect((await route(post({ mfaToken: 'cid.secret', factorId }), ['mfa-challenge'])).status).toBe(200);
    expect(calls[0]?.url).toBe('https://api.komtru.com/v1/auth/mfa/challenge');
  });

  it('release revokes the session behind the bearer token', async () => {
    const { route, calls, store } = setup();
    store.put('at-1', 'rt-1');
    const response = await route(post({}, { authorization: 'Bearer at-1' }), ['release']);
    expect(response.status).toBe(200);
    expect(calls[0]?.url).toBe('https://api.komtru.com/v1/auth/logout');
    expect(calls[0]?.body).toEqual({ refreshToken: 'rt-1', allDevices: false });
  });

  it('404s anything else', async () => {
    const { route } = setup();
    expect((await route(post({}), ['refresh'])).status).toBe(404);
    expect((await route(post({}), ['sign-in', 'x'])).status).toBe(404);
  });
});
