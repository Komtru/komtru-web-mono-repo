// Two cookies carry a Komtru web session, and neither of them is the access token.
//
//   komtru_rt       the backend's refresh token. httpOnly, and scoped to `/api/auth` so it is sent
//                   only to the three route handlers that may read it — not to a page, not to a
//                   Server Action, not to any other route.
//   komtru_session  a sealed hint saying which scope the session has and when it lapses, so
//                   middleware can turn a consumer away from ops.komtru.com without a round trip.
//                   It may also carry the app's own facts about the person (F-037: has sold, is
//                   certified), read when the session was issued, because a page render holds no
//                   credential to ask the backend with. Facts decide what a page shows, never what
//                   the person may do: the backend authorises every call.
//
// The hint is HMAC-sealed because middleware would otherwise be enforcing a value the caller
// chooses: a cookie header is attacker-controlled, httpOnly or not. Sealing makes the middleware's
// answer real **within this app**. It is still not an authorization boundary — the backend's token
// check is — but it is the difference between "anyone can see the console shell" and "nobody can".
//
// Web Crypto only: middleware runs in the Edge runtime, which has no `node:crypto`.
import { sessionScopeSchema, type SessionScope } from '@komtru/shared-types';

export const REFRESH_COOKIE = 'komtru_rt';
export const SESSION_COOKIE = 'komtru_session';
export const SESSION_SECRET_ENV = 'KOMTRU_SESSION_SECRET';

/** 256 bits of entropy, written as 32 ASCII characters. Shorter is a secret someone typed. */
export const MIN_SECRET_LENGTH = 32;

const VERSION = 'v1';

/**
 * Yes-or-no facts about the person, named by the app that seals them. Booleans only, and few: the cookie
 * rides on every request, and anything richer belongs in a read.
 */
export type SessionFacts = Readonly<Record<string, boolean>>;

/** Enough for an app's shell; a bound so a hint can never grow into a payload. */
export const MAX_SESSION_FACTS = 8;
const FACT_NAME = /^[A-Za-z][A-Za-z0-9]{0,31}$/;

/**
 * The facts in a payload, or `undefined` for anything that is not a small object of named booleans. Not
 * a refusal of the session: a hint sealed by an older or newer build is still a real session, and the
 * safe reading of facts it cannot understand is "none" — the smallest shell.
 */
const readFacts = (value: unknown): SessionFacts | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > MAX_SESSION_FACTS) return undefined;
  for (const [name, fact] of entries) {
    if (!FACT_NAME.test(name) || typeof fact !== 'boolean') return undefined;
  }
  return Object.fromEntries(entries);
};

export interface SessionHint {
  scope: SessionScope;
  /** Epoch milliseconds. Advisory for the client, binding for `open`. */
  expiresAt: number;
  /** Absent when the app asked for none, the read failed, or the hint predates them. */
  facts?: SessionFacts;
}

export interface SessionSealer {
  seal(hint: SessionHint): Promise<string>;
  /** `null` for anything that does not verify: no cookie, wrong secret, wrong version, garbage, expired. */
  open(token: string | undefined, now?: number): Promise<SessionHint | null>;
}

const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// Backed by an `ArrayBuffer` explicitly: `Uint8Array.from` is typed over `ArrayBufferLike`, which
// includes `SharedArrayBuffer`, and `crypto.subtle` accepts neither that nor a union containing it.
const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

export function requireSessionSecret(env: Record<string, string | undefined>): string {
  const secret = env[SESSION_SECRET_ENV];
  if (secret === undefined || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${SESSION_SECRET_ENV} must be set to at least ${MIN_SECRET_LENGTH} characters; middleware cannot tell a real session from a made-up one without it`,
    );
  }
  return secret;
}

export function createSessionSealer(secret: string): SessionSealer {
  // Imported once per sealer, not once per request: middleware runs this on every navigation.
  const keyPromise = crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );

  const seal = async (hint: SessionHint): Promise<string> => {
    // Seconds, not milliseconds: the payload rides in a cookie on every request.
    const facts = readFacts(hint.facts);
    const body = toBase64Url(
      encoder.encode(
        JSON.stringify({
          s: hint.scope,
          e: Math.floor(hint.expiresAt / 1000),
          ...(facts === undefined ? {} : { f: facts }),
        }),
      ),
    );
    const signed = `${VERSION}.${body}`;
    const mac = await crypto.subtle.sign('HMAC', await keyPromise, encoder.encode(signed));
    return `${signed}.${toBase64Url(new Uint8Array(mac))}`;
  };

  const open = async (token: string | undefined, now = Date.now()): Promise<SessionHint | null> => {
    if (token === undefined || token === '') return null;
    try {
      // Exactly three parts: `v1.<body>.<sig>.anything` would otherwise verify, which makes two
      // distinct cookie strings the same session. Not forgeable, but a malleable security token is
      // not a thing to leave lying around.
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [version, body, signature] = parts as [string, string, string];
      if (version !== VERSION) return null;

      // `crypto.subtle.verify`, not a string compare: the platform's comparison is the constant-time
      // one, and a hand-rolled `===` on a MAC is the classic timing leak.
      const valid = await crypto.subtle.verify(
        'HMAC',
        await keyPromise,
        fromBase64Url(signature),
        encoder.encode(`${version}.${body}`),
      );
      if (!valid) return null;

      const payload: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
      if (typeof payload !== 'object' || payload === null) return null;
      const { s, e, f } = payload as { s?: unknown; e?: unknown; f?: unknown };

      // A valid signature proves the payload is ours. It does not prove the scope is still a scope:
      // a hint sealed before `SESSION_SCOPES` changed would otherwise be let through under a name
      // nothing understands.
      const scope = sessionScopeSchema.safeParse(s);
      if (!scope.success || typeof e !== 'number' || !Number.isFinite(e)) return null;

      const expiresAt = e * 1000;
      if (expiresAt <= now) return null;
      const facts = readFacts(f);
      return { scope: scope.data, expiresAt, ...(facts === undefined ? {} : { facts }) };
    } catch {
      // Every failure here is a cookie someone made up. Middleware runs on every navigation, so a
      // throw would be a 500 on every page of the app rather than a redirect to sign in.
      return null;
    }
  };

  return { seal, open };
}

export interface KomtruCookie {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
}

export interface SessionCookieInput {
  refreshToken: string;
  sealed: string;
  maxAgeSeconds: number;
  secure: boolean;
}

/**
 * Neither cookie sets `Domain`, which makes both host-only: `ops.komtru.com`'s session is never sent
 * to `app.komtru.com`, which is exactly the ticket's "scoped to the app's host". `SameSite=Lax` lets
 * a sign-in link from an email land on a page that already knows who you are, while keeping the
 * cookie off a cross-site POST.
 */
export function sessionCookies({
  refreshToken,
  sealed,
  maxAgeSeconds,
  secure,
}: SessionCookieInput): KomtruCookie[] {
  const base = { httpOnly: true, secure, sameSite: 'lax', maxAge: maxAgeSeconds } as const;
  return [
    { ...base, name: REFRESH_COOKIE, value: refreshToken, path: '/api/auth' },
    { ...base, name: SESSION_COOKIE, value: sealed, path: '/' },
  ];
}

/** Same names, same paths — a cookie cleared at the wrong path is not cleared at all. */
export function clearedCookies(secure: boolean): KomtruCookie[] {
  const base = { httpOnly: true, secure, sameSite: 'lax', maxAge: 0, value: '' } as const;
  return [
    { ...base, name: REFRESH_COOKIE, path: '/api/auth' },
    { ...base, name: SESSION_COOKIE, path: '/' },
  ];
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * `Secure` everywhere except a plain-http loopback request, where Safari refuses to store a Secure
 * cookie and local sign-in would fail with nothing saying why. Plain http to a *real* host keeps
 * `Secure`: that is a misconfigured deployment, and a browser dropping the cookie is a better
 * outcome than a session credential travelling in the clear.
 */
export function secureCookieFor(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  return !LOOPBACK.has(url.hostname);
}
