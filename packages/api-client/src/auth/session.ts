// The access token lives in memory only: never localStorage, never a non-httpOnly cookie, so a
// stolen DOM cannot carry it away and a tab close really does end it. The refresh token never
// reaches this package at all — it is an httpOnly cookie the app's own route handler holds, which
// is why `refresh` is a callback into the app rather than a call to the backend.
import { sessionScopeSchema, type SessionScope } from '@komtru/shared-types';
import { z } from 'zod';
import { problemFromResponse, readResponseMeta } from '../problems.js';

export const authSessionSchema = z.object({
  accessToken: z.string().min(1),
  scope: sessionScopeSchema,
  /** Epoch milliseconds, when the route handler chooses to say. Advisory: the 401 is the truth. */
  expiresAt: z.number().int().positive().optional(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;

/** The app's own Next route handlers (T-017), same-origin, so the refresh cookie is sent. */
export const AUTH_ROUTE_BASE = '/api/auth';

export const authRoutePaths = (base: string = AUTH_ROUTE_BASE) => ({
  login: `${base}/login`,
  refresh: `${base}/refresh`,
  logout: `${base}/logout`,
});

/**
 * The backend's scoped login routes (design §7.3). One user, three ways in; Park Agents use the
 * LOGISTICS route, which is why no fourth scope exists. T-031/T-034 own these endpoints; the apps'
 * route handlers are what call them.
 */
export const backendLoginPath = (scope: SessionScope): string => `/auth/${scope.toLowerCase()}/login`;

export interface TokenSnapshot {
  accessToken: string | null;
  /**
   * Which token this is. A request records it before sending; a 401 whose generation is already
   * behind the store's means someone else refreshed in the meantime, so there is nothing to do but
   * retry with the new token.
   */
  generation: number;
}

export interface TokenStoreOptions {
  /** Resolves the new session, or `null` when the refresh credential is gone and the session is over. */
  refresh: () => Promise<AuthSession | null>;
  onSessionEnded?: () => void;
}

export interface TokenStore {
  read: () => TokenSnapshot;
  session: () => AuthSession | null;
  set: (session: AuthSession | null) => void;
  /** Single-flight. Pass the generation the caller's request was sent with. */
  refreshOnce: (seen: number) => Promise<TokenSnapshot>;
  subscribe: (listener: (session: AuthSession | null) => void) => () => void;
}

export function createTokenStore({ refresh, onSessionEnded }: TokenStoreOptions): TokenStore {
  let current: AuthSession | null = null;
  let generation = 0;
  let inFlight: Promise<TokenSnapshot> | null = null;
  const listeners = new Set<(session: AuthSession | null) => void>();

  const read = (): TokenSnapshot => ({ accessToken: current?.accessToken ?? null, generation });

  const set = (next: AuthSession | null): void => {
    current = next;
    generation += 1;
    for (const listener of listeners) listener(next);
  };

  const refreshOnce = (seen: number): Promise<TokenSnapshot> => {
    // Someone already replaced the token this request used. Retrying is enough; refreshing again
    // would invalidate the perfectly good token every other in-flight request is about to use.
    if (seen < generation) return Promise.resolve(read());
    if (inFlight) return inFlight;

    inFlight = refresh()
      .then((next) => {
        if (next === null) {
          set(null);
          onSessionEnded?.();
        } else {
          set(next);
        }
        return read();
      })
      .finally(() => {
        // Cleared whether it worked or not: a refresh that failed on a flaky connection must not
        // poison every later 401, and one that worked has already bumped the generation.
        inFlight = null;
      });
    return inFlight;
  };

  const subscribe = (listener: (session: AuthSession | null) => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { read, session: () => current, set, refreshOnce, subscribe };
}

export interface RouteHandlerRefreshOptions {
  fetch?: typeof globalThis.fetch;
  /** Defaults to the app's own `/api/auth`. */
  base?: string;
}

/**
 * Calls the app's refresh route handler, which is the only thing that can read the httpOnly refresh
 * cookie. A 401 means the session is over; anything else is an error, because treating a 500 as a
 * sign-out would log everyone out whenever the backend hiccups.
 */
export function createRouteHandlerRefresh({
  fetch: fetchImpl,
  base = AUTH_ROUTE_BASE,
}: RouteHandlerRefreshOptions = {}): () => Promise<AuthSession | null> {
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = authRoutePaths(base).refresh;

  return async () => {
    const response = await doFetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 401) return null;

    const text = await response.text();
    const body: unknown = text === '' ? undefined : (JSON.parse(text) as unknown);
    if (!response.ok) {
      throw problemFromResponse(response.status, body, readResponseMeta(response.headers, response.status));
    }
    return authSessionSchema.parse(body);
  };
}
