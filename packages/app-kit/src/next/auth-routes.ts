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

/** The same bound `@komtru/api-client`'s transport uses, so both halves give up together. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** M1's 30-day sliding window. The backend's own expiry is the truth; this bounds the cookie. */
export const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** The backend serves one login route and decides the scope from the account (`/v1/auth/login`). */
export const DEFAULT_LOGIN_PATH = '/auth/login';

/** The second step of a login that answered with a challenge, and the route that sends its code. */
export const DEFAULT_MFA_VERIFY_PATH = '/auth/mfa/verify';
export const DEFAULT_MFA_CHALLENGE_PATH = '/auth/mfa/challenge';

export interface AuthRouteOptions {
  config: AppConfig;
  sealer: SessionSealer;
  fetch?: typeof globalThis.fetch;
  loginPath?: string;
  /** A console passes `/auth/staff/mfa/verify`: the staff routes are separate from the consumer ones. */
  mfaVerifyPath?: string;
  mfaChallengePath?: string;
  refreshMaxAgeSeconds?: number;
  /** How long to wait for the backend before answering 502. Matches api-client's own default. */
  timeoutMs?: number;
}

export interface AuthRouteHandlers {
  login(request: Request): Promise<Response>;
  /** The second step, for a login that answered with a challenge. Opens the session. */
  mfa(request: Request): Promise<Response>;
  /** Asks the backend to send the code for an SMS or email factor. Opens nothing. */
  mfaChallenge(request: Request): Promise<Response>;
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

/**
 * §10.1's second 200: the password was right and a factor is still owed. A body that carries a
 * token beside `mfaRequired` is not a challenge, it is a backend bug, and passing it through would
 * hand the browser a credential this handler never sealed — so it is refused here, and falls
 * through to the session check, which refuses it too.
 */
const backendChallengeSchema = z
  .looseObject({
    mfaRequired: z.literal(true),
    mfaToken: z.string().min(1).max(512),
    expiresAt: z.number().int().positive(),
    factors: z.array(z.looseObject({ id: z.string(), type: z.string() })),
  })
  .refine((body) => !('accessToken' in body) && !('refreshToken' in body));

const mfaRequestSchema = z.object({
  mfaToken: z.string().min(1).max(512),
  factorId: z.string().min(1),
  code: z.string().min(1).max(64),
  deviceFingerprint: z.unknown().optional(),
});

const mfaChallengeRequestSchema = z.object({
  mfaToken: z.string().min(1).max(512),
  factorId: z.string().min(1),
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

/** Keyed per app as well as per token: two apps in one process must not share a sealed cookie. */
const rotationKey = (appName: string, refreshToken: string): string => `${appName}\u0000${refreshToken}`;

export function createAuthRouteHandlers({
  config,
  sealer,
  fetch: fetchImpl,
  loginPath = DEFAULT_LOGIN_PATH,
  mfaVerifyPath = DEFAULT_MFA_VERIFY_PATH,
  mfaChallengePath = DEFAULT_MFA_CHALLENGE_PATH,
  refreshMaxAgeSeconds = REFRESH_MAX_AGE_SECONDS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: AuthRouteOptions): AuthRouteHandlers {
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);

  /**
   * `Secure` is decided from the app's own declared origin, never from the request. A request's
   * Host header is whatever reached the process: behind a TLS-terminating proxy that forwards to
   * `http://localhost` the request looks like loopback, and a production session cookie would lose
   * `Secure` on the strength of it.
   */
  const secure = secureCookieFor(new URL(config.appUrl));

  /**
   * Bounded. A backend that accepts the connection and never answers would otherwise hold the
   * request open forever *and* pin the rotation below, so every later tab with that token would
   * block on the same dead promise.
   */
  const callBackend = async (path: string, body: unknown): Promise<Response> =>
    doFetch(`${config.apiUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

  /**
   * `undefined` for an empty or unparseable body. A truncated request is what a flaky mobile
   * connection produces, and an unguarded `JSON.parse` turns it into a 500 — on `logout`, a 500
   * that never reaches the line clearing the cookies, leaving the person signed in on a shared
   * phone. The schemas below decide what a missing body means; this only has to not throw.
   */
  const readJson = async (request: Request): Promise<unknown> => {
    try {
      const text = await request.text();
      return text === '' ? undefined : (JSON.parse(text) as unknown);
    } catch {
      return undefined;
    }
  };

  /** The browser gets the session minus the one field that must never leave this process. */
  const issue = async (backendBody: Record<string, unknown>): Promise<Response> => {
    const parsed = backendSessionSchema.safeParse(backendBody);
    if (!parsed.success) {
      return problem(
        502,
        'BAD_GATEWAY',
        'Sign-in is unavailable',
        'The platform answered with a session this app does not understand',
      );
    }
    // An allowlist, not `{ ...backendBody }` minus one key. A denylist means any field the backend
    // grows later — a device secret, an MFA challenge, an internal id — reaches the browser by
    // default, which is the wrong default on a platform whose responses carry credentials.
    // `nextStep` and `user` are named because T-111's sign-in screen branches on them.
    const forBrowser: Record<string, unknown> = {
      accessToken: parsed.data.accessToken,
      scope: parsed.data.scope,
      expiresIn: parsed.data.expiresIn,
      expiresAt: parsed.data.expiresAt,
    };
    if (backendBody.nextStep !== undefined) forBrowser.nextStep = backendBody.nextStep;
    if (backendBody.user !== undefined) forBrowser.user = backendBody.user;
    const refreshToken = parsed.data.refreshToken;
    const sealed = await sealer.seal({ scope: parsed.data.scope, expiresAt: expiryOf(refreshMaxAgeSeconds) });
    return json(
      forBrowser,
      200,
      sessionCookies({
        refreshToken,
        sealed,
        maxAgeSeconds: refreshMaxAgeSeconds,
        secure,
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

    return finishSignIn(payload);
  };

  /**
   * What a login or a second-factor answer turns into. Three outcomes: a challenge (no credential,
   * so no cookie), a session of this app's scope (cookies and an access token), or a session of
   * another scope, which is revoked before the refusal.
   */
  const finishSignIn = async (payload: Record<string, unknown> | undefined): Promise<Response> => {
    const challenge = backendChallengeSchema.safeParse(payload);
    if (challenge.success) {
      // An allowlist again: the factor hints are named, and nothing else the backend adds rides along.
      return json(
        {
          mfaRequired: true,
          mfaToken: challenge.data.mfaToken,
          expiresAt: challenge.data.expiresAt,
          factors: challenge.data.factors,
        },
        200,
      );
    }

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

    return issue(payload ?? {});
  };

  /** Shared by the two second-step handlers: validate, call, and pass the backend's problem through. */
  const secondStep = async (
    request: Request,
    path: string,
    schema: z.ZodType<Record<string, unknown>>,
  ): Promise<{ response: Response } | { payload: Record<string, unknown> | undefined }> => {
    const body = schema.safeParse(await readJson(request));
    if (!body.success) {
      return {
        response: problem(
          422,
          'VALIDATION_FAILED',
          'That is not a second-factor answer',
          'Send the sign-in token, the factor and the code',
        ),
      };
    }
    let upstream: Response;
    try {
      upstream = await callBackend(path, body.data);
    } catch {
      return {
        response: problem(
          502,
          'BAD_GATEWAY',
          'Sign-in is unavailable',
          'The platform did not answer; try again',
        ),
      };
    }
    const payload = (await upstream.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    // Verbatim, so a wrong code keeps its `attemptsRemaining`.
    if (!upstream.ok) return { response: json(payload ?? {}, upstream.status) };
    return { payload };
  };

  const mfa = async (request: Request): Promise<Response> => {
    const result = await secondStep(request, mfaVerifyPath, mfaRequestSchema);
    return 'response' in result ? result.response : finishSignIn(result.payload);
  };

  const mfaChallenge = async (request: Request): Promise<Response> => {
    const result = await secondStep(request, mfaChallengePath, mfaChallengeRequestSchema);
    // Nothing here can open a session, so the body is the backend's own: kind, destination, options.
    return 'response' in result ? result.response : json(result.payload ?? {}, 200);
  };

  const rotate = async (refreshToken: string): Promise<Response> => {
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
      return json(payload ?? {}, 401, clearedCookies(secure));
    }
    // A 500 or a 503 is the platform having a bad minute. Clearing cookies here would sign every
    // signed-in user out at once, over something that fixes itself.
    if (!upstream.ok) return json(payload ?? {}, upstream.status);

    return issue(payload ?? {});
  };

  const refresh = async (request: Request): Promise<Response> => {
    const refreshToken = readCookie(request, REFRESH_COOKIE);
    if (refreshToken === undefined) {
      return problem(401, 'UNAUTHENTICATED', 'There is no session here', 'Sign in again');
    }

    const key = rotationKey(config.appName, refreshToken);
    const inFlight = rotations.get(key);
    if (inFlight) return (await inFlight).clone();

    const started = rotate(refreshToken).finally(() => rotations.delete(key));
    rotations.set(key, started);
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

    return json({ ok: true }, 200, clearedCookies(secure));
  };

  return { login, mfa, mfaChallenge, refresh, logout };
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
    switch (name) {
      case 'login':
        return handlers.login(request);
      case 'mfa':
        return handlers.mfa(request);
      case 'mfa-challenge':
        return handlers.mfaChallenge(request);
      case 'refresh':
        return handlers.refresh(request);
      case 'logout':
        return handlers.logout(request);
      default:
        return problem(
          404,
          'NOT_FOUND',
          'No such route',
          'Only login, mfa, mfa-challenge, refresh and logout exist here',
        );
    }
  };
}
