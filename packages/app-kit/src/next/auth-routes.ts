// `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout` — the three handlers that stand
// between the browser and the backend's session routes, and the only code anywhere that touches a
// refresh token.
//
// The division of labour, which is the whole design: the **backend** mints an access token and a
// refresh token; the **route handler** keeps the refresh token in an httpOnly cookie the browser
// cannot read and hands back only the access token; `@komtru/api-client` keeps that access token in
// memory and, on a 401, calls `/api/auth/refresh` — same origin, so the cookie rides along — to get
// a new one. Nothing ever writes a credential to `localStorage` and no JavaScript ever sees the
// refresh token.
import { sessionScopeSchema } from '@komtru/shared-types';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import {
  clearedCookies,
  REFRESH_COOKIE,
  secureCookieFor,
  sessionCookies,
  type KomtruCookie,
  type SessionSealer,
} from '../session.js';

/** M1's 30-day sliding window. The backend's own expiry is the truth; this bounds the cookie. */
export const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** The backend serves one login route and decides the scope from the account (`/v1/auth/login`). */
export const DEFAULT_LOGIN_PATH = '/auth/login';

export interface AuthRouteOptions {
  config: AppConfig;
  sealer: SessionSealer;
  fetch?: typeof globalThis.fetch;
  loginPath?: string;
  refreshMaxAgeSeconds?: number;
}

export interface AuthRouteHandlers {
  login(request: Request): Promise<Response>;
  refresh(request: Request): Promise<Response>;
  logout(request: Request): Promise<Response>;
}

/** What `apps/backend-api` returns from `/auth/login` and `/auth/refresh` (M1 §10.1). */
const backendSessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  scope: sessionScopeSchema,
  expiresIn: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
});

const loginRequestSchema = z.object({
  identifier: z.string().min(1).max(254),
  password: z.string().min(1),
  deviceFingerprint: z.unknown().optional(),
});

const logoutRequestSchema = z.object({ allDevices: z.boolean().default(false) });

const NO_STORE = { 'cache-control': 'no-store' } as const;

const json = (body: unknown, status: number, cookies: KomtruCookie[] = []): Response => {
  const response = Response.json(body, { status, headers: NO_STORE });
  for (const cookie of cookies) response.headers.append('set-cookie', serialiseCookie(cookie));
  return response;
};

/**
 * Serialised here rather than through `NextResponse.cookies`, so these handlers are plain
 * `Request`/`Response` functions: testable without a Next runtime, and usable from any route file.
 */
const serialiseCookie = (cookie: KomtruCookie): string => {
  const parts = [
    `${cookie.name}=${cookie.value}`,
    `Path=${cookie.path}`,
    `Max-Age=${String(cookie.maxAge)}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (cookie.secure) parts.push('Secure');
  return parts.join('; ');
};

const problem = (status: number, code: string, title: string, detail: string): Response =>
  json({ type: 'about:blank', status, code, title, detail }, status);

const readCookie = (request: Request, name: string): string | undefined => {
  const header = request.headers.get('cookie');
  if (header === null) return undefined;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    if (pair.slice(0, index).trim() === name) return pair.slice(index + 1).trim();
  }
  return undefined;
};

/**
 * In-flight rotations, keyed by the refresh token the caller arrived with. Two tabs that both
 * notice a 401 at the same moment send the same token twice; the backend treats the second as a
 * replay and revokes the whole family (M1 D5), which signs the user out of a session that was never
 * compromised. Sharing one rotation makes the common case — one browser, one server instance —
 * safe. It is not a complete fix: two app instances behind a load balancer still race, because this
 * map is per process. The complete fix is a grace window on the backend's reuse detection.
 */
const rotations = new Map<string, Promise<Response>>();

export function createAuthRouteHandlers({
  config,
  sealer,
  fetch: fetchImpl,
  loginPath = DEFAULT_LOGIN_PATH,
  refreshMaxAgeSeconds = REFRESH_MAX_AGE_SECONDS,
}: AuthRouteOptions): AuthRouteHandlers {
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);

  const callBackend = async (path: string, body: unknown): Promise<Response> =>
    doFetch(`${config.apiUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });

  const readJson = async (request: Request): Promise<unknown> => {
    const text = await request.text();
    return text === '' ? undefined : (JSON.parse(text) as unknown);
  };

  /** The browser gets the session minus the one field that must never leave this process. */
  const issue = async (backendBody: Record<string, unknown>, request: Request): Promise<Response> => {
    const parsed = backendSessionSchema.safeParse(backendBody);
    if (!parsed.success) {
      return problem(
        502,
        'BAD_GATEWAY',
        'Sign-in is unavailable',
        'The platform answered with a session this app does not understand',
      );
    }
    const { refreshToken, ...forBrowser } = { ...backendBody, ...parsed.data };
    const sealed = await sealer.seal({ scope: parsed.data.scope, expiresAt: expiryOf(refreshMaxAgeSeconds) });
    return json(
      forBrowser,
      200,
      sessionCookies({
        refreshToken,
        sealed,
        maxAgeSeconds: refreshMaxAgeSeconds,
        secure: secureCookieFor(new URL(request.url)),
      }),
    );
  };

  const login = async (request: Request): Promise<Response> => {
    const body = loginRequestSchema.safeParse(await readJson(request));
    if (!body.success) {
      return problem(422, 'VALIDATION_FAILED', 'That is not a sign-in', 'Send an identifier and a password');
    }

    let upstream: Response;
    try {
      upstream = await callBackend(loginPath, body.data);
    } catch {
      return problem(502, 'BAD_GATEWAY', 'Sign-in is unavailable', 'The platform did not answer; try again');
    }

    const payload = (await upstream.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    // The backend's own problem details, verbatim: T-111 branches on `INVALID_CREDENTIALS`, and a
    // code rewritten here is a code a screen cannot act on.
    if (!upstream.ok) return json(payload ?? {}, upstream.status);

    const parsed = backendSessionSchema.safeParse(payload);
    if (parsed.success && parsed.data.scope !== config.scope) {
      // The account is real and the password was right — the session simply belongs to another app.
      // Revoke it before answering: a session nobody can use is still a session, and leaving one
      // behind on every mistyped host is how a session list fills with ghosts.
      await callBackend('/auth/logout', { refreshToken: parsed.data.refreshToken, allDevices: false }).catch(
        () => undefined,
      );
      return problem(
        403,
        'WRONG_SCOPE',
        'This account cannot sign in here',
        `This sign-in is for ${config.scope.toLowerCase()} accounts`,
      );
    }

    return issue(payload ?? {}, request);
  };

  const rotate = async (request: Request, refreshToken: string): Promise<Response> => {
    let upstream: Response;
    try {
      upstream = await callBackend('/auth/refresh', { refreshToken });
    } catch {
      // Offline, DNS, a dead backend. Not a sign-out: the credential is still good.
      return problem(
        502,
        'BAD_GATEWAY',
        'Could not reach the platform',
        'Check the connection and try again',
      );
    }

    const payload = (await upstream.json().catch(() => undefined)) as Record<string, unknown> | undefined;

    if (upstream.status === 401) {
      // The one status that means the credential is gone. `api-client` reads a 401 here as "the
      // session is over" and stops retrying, so nothing else may answer with one.
      return json(payload ?? {}, 401, clearedCookies(secureCookieFor(new URL(request.url))));
    }
    // A 500 or a 503 is the platform having a bad minute. Clearing cookies here would sign every
    // signed-in user out at once, over something that fixes itself.
    if (!upstream.ok) return json(payload ?? {}, upstream.status);

    return issue(payload ?? {}, request);
  };

  const refresh = async (request: Request): Promise<Response> => {
    const refreshToken = readCookie(request, REFRESH_COOKIE);
    if (refreshToken === undefined) {
      return problem(401, 'UNAUTHENTICATED', 'There is no session here', 'Sign in again');
    }

    const inFlight = rotations.get(refreshToken);
    if (inFlight) return (await inFlight).clone();

    const started = rotate(request, refreshToken).finally(() => rotations.delete(refreshToken));
    rotations.set(refreshToken, started);
    return (await started).clone();
  };

  const logout = async (request: Request): Promise<Response> => {
    const body = logoutRequestSchema.safeParse((await readJson(request)) ?? {});
    const refreshToken = readCookie(request, REFRESH_COOKIE);

    if (refreshToken !== undefined) {
      // Best effort. Signing out locally must work even when the platform cannot be reached —
      // refusing to clear the cookie would leave the person signed in on a shared phone.
      await callBackend('/auth/logout', {
        refreshToken,
        allDevices: body.success ? body.data.allDevices : false,
      }).catch(() => undefined);
    }

    return json({ ok: true }, 200, clearedCookies(secureCookieFor(new URL(request.url))));
  };

  return { login, refresh, logout };
}

const expiryOf = (maxAgeSeconds: number): number => Date.now() + maxAgeSeconds * 1000;

export interface AuthRouteContext {
  params: Promise<{ action: string[] }>;
}

/** One catch-all route file: `export const POST = komtruAuthRoute(options)`. */
export function komtruAuthRoute(
  options: AuthRouteOptions,
): (request: Request, context: AuthRouteContext) => Promise<Response> {
  const handlers = createAuthRouteHandlers(options);
  return async (request, context) => {
    const { action } = await context.params;
    const name = action.length === 1 ? action[0] : undefined;
    if (name !== 'login' && name !== 'refresh' && name !== 'logout') {
      return problem(404, 'NOT_FOUND', 'No such route', 'Only login, refresh and logout exist here');
    }
    return handlers[name](request);
  };
}
