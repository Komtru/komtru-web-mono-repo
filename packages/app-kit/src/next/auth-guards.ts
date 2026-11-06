// What stands in front of the auth route handlers: the browser-only guard, the limiter, the client
// the backend should see, and the server-side home for a refresh token that must not reach a
// browser.
//
// Everything here is in process memory. That is right for one instance and wrong behind several:
// each instance has its own counters and its own refresh store, so the limits multiply by the
// instance count and a release can land on an instance that never saw the sign-in. **Move the
// limiter and the store to Redis before running more than one instance** (the platform's `ioredis`
// connection is the natural home); the interfaces below are what that change has to satisfy.

/**
 * The cheap, standard CSRF defence for a JSON API that uses cookies: a cross-site page can send a
 * form post (text/plain, urlencoded, multipart) without a preflight, and cannot send
 * `application/json` without one the route does not answer. The Origin check is the second lock:
 * browsers attach it to every cross-origin POST. `null` string means an opaque origin (a sandboxed
 * frame, a `data:` page) and is never the app.
 *
 * Returns a reason, or `null` when the request may proceed.
 */
export function checkSameOriginJson(request: Request, appOrigin: string): string | null {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json(\s*;|$)/i.test(type.trim())) return 'The request must be application/json';

  const origin = request.headers.get('origin');
  if (origin !== null) {
    return origin === appOrigin ? null : 'The request did not come from this app’s own origin';
  }
  const referer = request.headers.get('referer');
  if (referer !== null && URL.canParse(referer)) {
    return new URL(referer).origin === appOrigin
      ? null
      : 'The request did not come from this app’s own origin';
  }
  return 'The request does not say where it came from';
}

/**
 * The address to count a request against: the **last** entry of `X-Forwarded-For`, which is the one
 * the nearest proxy appended. The first is whatever the caller typed. Without a proxy there is no
 * address to read and every caller shares the `unknown` bucket, which is a local-development
 * property and not a production one.
 */
export function clientIpOf(request: Request): string {
  const chain = request.headers.get('x-forwarded-for');
  if (chain !== null) {
    const last = chain.split(',').at(-1)?.trim();
    if (last !== undefined && last !== '') return last;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * What the backend needs to see the real client rather than this server: the forwarded chain
 * exactly as it arrived, and the user agent. A route handler has no socket, so this server cannot
 * append its own peer address; the backend's `TRUST_PROXY_HOPS` must therefore count the proxies
 * *in front of* this app and not this app itself, or `req.ip` lands one entry too far left and is
 * attacker-chosen.
 */
export function forwardHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  const chain = request.headers.get('x-forwarded-for');
  if (chain !== null && chain !== '') headers['x-forwarded-for'] = chain;
  const agent = request.headers.get('user-agent');
  if (agent !== null && agent !== '') headers['user-agent'] = agent;
  return headers;
}

export interface RateLimiter {
  /** Spends a point. `null` when allowed, else the seconds until a point is free. */
  take(key: string): number | null;
  size(): number;
}

export interface RateLimiterOptions {
  points: number;
  windowMs: number;
  now?: () => number;
  /** A hard bound on remembered keys; the oldest go first. */
  maxKeys?: number;
}

/** A fixed window per key. Coarse on purpose: the backend's own limiter is the fine one. */
export function createRateLimiter({
  points,
  windowMs,
  now = Date.now,
  maxKeys = 10_000,
}: RateLimiterOptions): RateLimiter {
  const windows = new Map<string, { start: number; used: number }>();

  const prune = (at: number): void => {
    for (const [key, window] of windows) if (at - window.start >= windowMs) windows.delete(key);
    // Still over the bound with every entry live: drop the oldest, which are first in insertion order.
    while (windows.size >= maxKeys) {
      const oldest = windows.keys().next().value;
      if (oldest === undefined) break;
      windows.delete(oldest);
    }
  };

  return {
    take(key) {
      const at = now();
      const window = windows.get(key);
      if (window === undefined || at - window.start >= windowMs) {
        if (windows.size >= maxKeys) prune(at);
        windows.set(key, { start: at, used: 1 });
        return null;
      }
      if (window.used >= points) return Math.max(1, Math.ceil((window.start + windowMs - at) / 1000));
      window.used += 1;
      return null;
    },
    size: () => windows.size,
  };
}

/** Where a refresh token waits while only its access token is in the browser. */
export interface RefreshStore {
  put(accessToken: string, refreshToken: string): void;
  /** Hands the refresh token over once. */
  take(accessToken: string): string | undefined;
  /** Removes and returns every expired refresh token, so the caller can revoke them. */
  sweep(): string[];
}

const digest = (value: string): string => {
  // Keyed by a hash so a heap dump of the store does not hold a usable access token. FNV-1a over
  // two lanes is not cryptographic and does not need to be: the key only has to be hard to hit by
  // accident, because `take` is also gated by holding the access token itself.
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < value.length; index += 1) {
    a = Math.imul(a ^ value.charCodeAt(index), 0x01000193);
    b = Math.imul(b + value.charCodeAt(index), 0x85ebca6b);
  }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}${value.length.toString(16)}`;
};

export function createMemoryRefreshStore({
  ttlMs,
  now = Date.now,
}: {
  ttlMs: number;
  now?: () => number;
}): RefreshStore & { keys(): string[] } {
  const entries = new Map<string, { refreshToken: string; expiresAt: number }>();
  return {
    put(accessToken, refreshToken) {
      entries.set(digest(accessToken), { refreshToken, expiresAt: now() + ttlMs });
    },
    take(accessToken) {
      const key = digest(accessToken);
      const entry = entries.get(key);
      entries.delete(key);
      return entry?.refreshToken;
    },
    sweep() {
      const at = now();
      const expired: string[] = [];
      for (const [key, entry] of entries) {
        if (entry.expiresAt <= at) {
          expired.push(entry.refreshToken);
          entries.delete(key);
        }
      }
      return expired;
    },
    keys: () => [...entries.keys()],
  };
}
