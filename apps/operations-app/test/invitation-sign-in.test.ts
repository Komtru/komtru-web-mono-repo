import { readAppConfig } from '@komtru/app-kit';
import { describe, expect, it, vi } from 'vitest';
import { appSpec } from '../src/app-config';
import { createInvitationSignIn } from '../src/auth/invitation-sign-in';

const config = readAppConfig(appSpec, {
  NEXT_PUBLIC_KOMTRU_APP_URL: 'https://ops.komtru.com',
  NEXT_PUBLIC_KOMTRU_API_URL: 'https://api.komtru.com/v1',
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const session = (scope: string) => ({
  accessToken: 'at-1',
  refreshToken: 'rt-1',
  scope,
  expiresIn: 600,
  expiresAt: 4_000_000_000_000,
  nextStep: 'NONE',
  user: { id: 'u1' },
});

const post = (body: unknown) =>
  new Request('https://ops.komtru.com/api/invitation/sign-in', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const handlerFor = (reply: Response) => {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
    calls.push({
      url,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    return Promise.resolve(reply);
  });
  return {
    handle: createInvitationSignIn({ config, fetch: fetchImpl as unknown as typeof fetch }),
    calls,
  };
};

describe('the invitation sign-in route', () => {
  it('signs the consumer account in and hands back the access token and nothing else', async () => {
    const { handle, calls } = handlerFor(json(session('CONSUMER')));
    const response = await handle(post({ identifier: 'amina@komtru.com', password: 'pw' }));
    expect(calls[0]).toEqual({
      url: 'https://api.komtru.com/v1/auth/login',
      body: { identifier: 'amina@komtru.com', password: 'pw' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accessToken: 'at-1', expiresAt: 4_000_000_000_000 });
    // No cookie of any kind: the refresh token stays here, so this is a door and not a session.
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('does not run a second factor it has no screen for', async () => {
    const { handle } = handlerFor(
      json({ mfaRequired: true, mfaToken: 'cid.secret', expiresAt: 4_000_000_000_000, factors: [] }),
    );
    const response = await handle(post({ identifier: 'a', password: 'b' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'MFA_NOT_SUPPORTED' });
  });

  it('refuses a session that is not a consumer one', async () => {
    const { handle } = handlerFor(json(session('STAFF')));
    expect((await handle(post({ identifier: 'a', password: 'b' }))).status).toBe(403);
  });

  it("passes the platform's own refusal through", async () => {
    const { handle } = handlerFor(json({ code: 'INVALID_CREDENTIALS', title: 'Sign in failed' }, 401));
    const response = await handle(post({ identifier: 'a', password: 'b' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('refuses a body that is not a sign-in, and a truncated one', async () => {
    const { handle, calls } = handlerFor(json(session('CONSUMER')));
    expect((await handle(post({ identifier: 'a' }))).status).toBe(422);
    expect((await handle(post('{"identifier":'))).status).toBe(422);
    expect(calls).toEqual([]);
  });

  it('answers 502 when the platform cannot be reached', async () => {
    const handle = createInvitationSignIn({
      config,
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    expect((await handle(post({ identifier: 'a', password: 'b' }))).status).toBe(502);
  });
});
