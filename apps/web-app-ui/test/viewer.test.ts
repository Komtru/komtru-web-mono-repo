// The viewer seam (F-037): who the shell is drawn for, from the session hint the auth route sealed.
import { createSessionSealer, SESSION_COOKIE, SESSION_SECRET_ENV } from '@komtru/app-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANONYMOUS_VIEWER, accountItemsFor } from '../src/shell/nav';
import { describeViewer, viewerFromHint } from '../src/shell/viewer-facts';

const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    }),
}));

const { resolveViewer } = await import('../src/shell/viewer');

const SECRET = 's'.repeat(32);
const sealer = createSessionSealer(SECRET);
const later = Date.now() + 3_600_000;
const links = { parkUrl: 'https://park.komtru.test' };

describe('viewerFromHint', () => {
  it('is the anonymous viewer without a hint, or with one that carries no facts', () => {
    expect(viewerFromHint(null)).toEqual(ANONYMOUS_VIEWER);
    expect(viewerFromHint({ scope: 'CONSUMER', expiresAt: later })).toEqual(ANONYMOUS_VIEWER);
  });

  it('is a seller who has sold when the facts say so', () => {
    expect(
      viewerFromHint({
        scope: 'CONSUMER',
        expiresAt: later,
        facts: { hasSold: true, certifiedMerchant: false },
      }),
    ).toEqual({ certifiedMerchant: false, hasSold: true, parkAgent: 'none' });
  });

  it('is a certified merchant when the facts say so', () => {
    expect(
      viewerFromHint({
        scope: 'CONSUMER',
        expiresAt: later,
        facts: { hasSold: false, certifiedMerchant: true },
      }),
    ).toMatchObject({ certifiedMerchant: true });
  });

  it('ignores the facts of a session that is not a consumer one', () => {
    expect(viewerFromHint({ scope: 'STAFF', expiresAt: later, facts: { hasSold: true } })).toEqual(
      ANONYMOUS_VIEWER,
    );
  });
});

describe('resolveViewer', () => {
  beforeEach(() => {
    cookieJar.clear();
    vi.stubEnv(SESSION_SECRET_ENV, SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('puts Payouts in Account for a signed-in seller who has sold', async () => {
    cookieJar.set(
      SESSION_COOKIE,
      await sealer.seal({
        scope: 'CONSUMER',
        expiresAt: later,
        facts: { hasSold: true, certifiedMerchant: false },
      }),
    );
    const viewer = await resolveViewer();
    expect(viewer.hasSold).toBe(true);
    expect(accountItemsFor(viewer, links).map((item) => item.href)).toContain('/account/payouts');
  });

  it('is anonymous with no session cookie', async () => {
    expect(await resolveViewer()).toEqual(ANONYMOUS_VIEWER);
  });

  it('is anonymous for a hint sealed with another secret, which is a hint someone made up', async () => {
    const forged = createSessionSealer('x'.repeat(32));
    cookieJar.set(
      SESSION_COOKIE,
      await forged.seal({ scope: 'CONSUMER', expiresAt: later, facts: { hasSold: true } }),
    );
    expect(await resolveViewer()).toEqual(ANONYMOUS_VIEWER);
  });

  it('is anonymous for an expired hint', async () => {
    cookieJar.set(
      SESSION_COOKIE,
      await sealer.seal({ scope: 'CONSUMER', expiresAt: Date.now() - 1, facts: { hasSold: true } }),
    );
    expect(await resolveViewer()).toEqual(ANONYMOUS_VIEWER);
  });

  it('is anonymous, not an error, when the deployment has no session secret', async () => {
    cookieJar.set(
      SESSION_COOKIE,
      await sealer.seal({ scope: 'CONSUMER', expiresAt: later, facts: { hasSold: true } }),
    );
    vi.stubEnv(SESSION_SECRET_ENV, '');
    expect(await resolveViewer()).toEqual(ANONYMOUS_VIEWER);
  });
});

describe('describeViewer', () => {
  const answering = (status: number, body: unknown) => {
    const calls: { url: string; authorization: string | null }[] = [];
    const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, authorization: new Headers(init?.headers).get('authorization') });
      return Promise.resolve(
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
      );
    });
    return { calls, describe: describeViewer({ apiUrl: 'https://api.komtru.test/v1', fetch }) };
  };

  it('reads GET /me/viewer with the access token it was given', async () => {
    const { calls, describe } = answering(200, { hasSold: true, certifiedMerchant: false });
    expect(await describe('at-1', new AbortController().signal)).toEqual({
      hasSold: true,
      certifiedMerchant: false,
    });
    expect(calls).toEqual([{ url: 'https://api.komtru.test/v1/me/viewer', authorization: 'Bearer at-1' }]);
  });

  it('fails, rather than inventing facts, when the platform refuses or answers nonsense', async () => {
    await expect(
      answering(401, { code: 'UNAUTHENTICATED' }).describe('at-1', new AbortController().signal),
    ).rejects.toThrow();
    await expect(
      answering(200, { hasSold: 'yes' }).describe('at-1', new AbortController().signal),
    ).rejects.toThrow();
  });
});
