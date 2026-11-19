// The canned platform API and the session seeder, end to end over HTTP and against the app's own sealer.
// No browser and no backend: the stand-in is started on an ephemeral port and the apps' contracts are
// checked by the same schemas the apps parse with.
import { createSessionSealer, subjectDigest } from '@komtru/app-kit';
import { tradeListResponseSchema, viewerFactsSchema } from '@komtru/shared-types';
import { describe, expect, it } from 'vitest';

import { checkFixtures } from '../src/standin/contracts.ts';
import { PERSONAS } from '../src/standin/personas.ts';
import { accessTokenFor, readBearer, readRefreshToken } from '../src/standin/identity.ts';
import { startStandin } from '../src/standin/server.ts';
import { sessionCookiesFor, STANDIN_NOW_MS, STANDIN_SESSION_SECRET } from '../src/standin/session.ts';

describe('the fixtures', () => {
  it('match the shared contracts the apps parse against', () => {
    expect(() => checkFixtures()).not.toThrow();
  });
});

describe('identity', () => {
  it('reads back the persona and scenario a refresh token names', () => {
    expect(readRefreshToken('vc.buyer.no-trades')).toEqual({
      persona: PERSONAS.buyer,
      scenario: 'no-trades',
    });
    expect(readRefreshToken('vc.buyer.elsewhere')).toBeNull();
    expect(readRefreshToken('a-real-looking-token')).toBeNull();
    expect(readRefreshToken(undefined)).toBeNull();
  });

  it('reads back the persona and scenario an access token names, and refuses anything else', () => {
    const token = accessTokenFor(PERSONAS.seller, 'with-trades', STANDIN_NOW_MS);
    expect(readBearer(`Bearer ${token}`)).toEqual({ persona: PERSONAS.seller, scenario: 'with-trades' });
    expect(readBearer(undefined)).toBeNull();
    expect(readBearer(`Bearer ${token}x`)).toBeNull();
    expect(readBearer('Bearer not.a.token')).toBeNull();
  });
});

describe('the stand-in over HTTP', () => {
  it('answers the routes the apps call, from fixtures typed against the contracts', async () => {
    const logged: string[] = [];
    const standin = await startStandin({ port: 0, log: (line) => logged.push(line) });
    try {
      const refresh = await fetch(`${standin.apiUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'vc.buyer.with-trades' }),
      });
      expect(refresh.status).toBe(200);
      const session = (await refresh.json()) as { accessToken: string; scope: string };
      expect(session.scope).toBe('CONSUMER');
      const auth = { authorization: `Bearer ${session.accessToken}` };

      const viewer = await fetch(`${standin.apiUrl}/me/viewer`, { headers: auth });
      expect(viewerFactsSchema.parse(await viewer.json())).toEqual(PERSONAS.buyer.facts);

      const trades = await fetch(`${standin.apiUrl}/trades?state=ALL`, { headers: auth });
      const list = tradeListResponseSchema.parse(await trades.json());
      expect(list.items.length).toBeGreaterThan(0);
      expect(list.nextCursor).toBeNull();

      const unsigned = await fetch(`${standin.apiUrl}/trades`);
      expect(unsigned.status).toBe(401);
      const unknown = await fetch(`${standin.apiUrl}/trades/0190b0a0-0000-7000-8000-000000000999`);
      expect(unknown.status).toBe(404);
      expect(logged.some((line) => line.startsWith('UNMATCHED GET /v1/trades/'))).toBe(true);
    } finally {
      await standin.close();
    }
  });

  it('refuses a staff session on a consumer route, as the backend does', async () => {
    const standin = await startStandin({ port: 0, log: () => undefined });
    try {
      const refresh = await fetch(`${standin.apiUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'vc.staff.with-trades' }),
      });
      const { accessToken } = (await refresh.json()) as { accessToken: string };
      const viewer = await fetch(`${standin.apiUrl}/me/viewer`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(viewer.status).toBe(403);
    } finally {
      await standin.close();
    }
  });
});

describe('the session seeder', () => {
  it('seals a session the app sealer opens, with the persona facts and the access token digest', async () => {
    const cookies = await sessionCookiesFor('merchant', 'with-trades', 'localhost');
    const sealed = cookies.find((cookie) => cookie.name === 'komtru_session');
    const refresh = cookies.find((cookie) => cookie.name === 'komtru_rt');
    expect(sealed?.path).toBe('/');
    expect(refresh?.path).toBe('/api/auth');
    expect(refresh?.value).toBe('vc.merchant.with-trades');

    const hint = await createSessionSealer(STANDIN_SESSION_SECRET).open(sealed?.value, STANDIN_NOW_MS);
    expect(hint?.scope).toBe('CONSUMER');
    expect(hint?.facts).toEqual(PERSONAS.merchant.facts);
    expect(hint?.subject).toBe(
      await subjectDigest(accessTokenFor(PERSONAS.merchant, 'with-trades', STANDIN_NOW_MS)),
    );
  });

  it('is deterministic: the same persona seals the same cookie on every run', async () => {
    const first = await sessionCookiesFor('buyer', 'no-trades');
    const second = await sessionCookiesFor('buyer', 'no-trades');
    expect(second).toEqual(first);
  });

  it('refuses a session sealed with any other secret', async () => {
    const [sealed] = await sessionCookiesFor('buyer', 'no-trades');
    const forged = await createSessionSealer('some-other-secret-that-is-long-enough').open(
      sealed?.value,
      STANDIN_NOW_MS,
    );
    expect(forged).toBeNull();
  });
});
