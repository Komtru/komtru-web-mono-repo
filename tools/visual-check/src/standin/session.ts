// The session seeder: a sealed `komtru_session` and a `komtru_rt` for a persona, written exactly as the
// app's own sign-in writes them. A ticket never logs in through the UI to reach a screen. The app must be
// started with `KOMTRU_SESSION_SECRET` set to `STANDIN_SESSION_SECRET`, or it refuses every seal as forged.
import { createSessionSealer, sessionCookies, subjectDigest } from '@komtru/app-kit';

import { accessTokenFor, refreshTokenFor } from './identity.ts';
import { PERSONAS, type PersonaId, type ScenarioId } from './personas.ts';
import { viewerFactsFor } from './fixtures.ts';

/** Not a credential: a fixed harness value, so an operator can start the app with the same secret. */
export const STANDIN_SESSION_SECRET = 'visual-check-standin-session-secret-0001';

/** The instant every fixture and token is stamped with. The browser clock is pinned to it per walk. */
export const STANDIN_NOW_MS = Date.parse('2026-11-19T09:00:00.000Z');

/** Far enough ahead that no visual check outlives its session, whatever the real clock says. */
export const SESSION_EXPIRES_AT_MS = Date.parse('2027-06-30T00:00:00.000Z');

/** A cookie in the shape Playwright's `addCookies` takes. */
export interface SeededCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax';
  expires: number;
}

/**
 * The two cookies a signed-in browser holds, for `host` (cookies ignore the port, so one seed serves every
 * Komtru app on localhost). `komtru_rt` stays scoped to `/api/auth`, as the app writes it.
 */
export async function sessionCookiesFor(
  persona: PersonaId,
  scenario: ScenarioId,
  host = 'localhost',
): Promise<SeededCookie[]> {
  const who = PERSONAS[persona];
  const accessToken = accessTokenFor(who, scenario, STANDIN_NOW_MS);
  const sealer = createSessionSealer(STANDIN_SESSION_SECRET);
  const sealed = await sealer.seal({
    scope: who.scope,
    expiresAt: SESSION_EXPIRES_AT_MS,
    facts: viewerFactsFor(persona),
    subject: await subjectDigest(accessToken),
  });
  const maxAgeSeconds = Math.floor((SESSION_EXPIRES_AT_MS - STANDIN_NOW_MS) / 1000);
  return sessionCookies({
    refreshToken: refreshTokenFor(who, scenario),
    sealed,
    maxAgeSeconds,
    secure: false,
  }).map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: host,
    path: cookie.path,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: 'Lax',
    expires: Math.floor(SESSION_EXPIRES_AT_MS / 1000),
  }));
}
