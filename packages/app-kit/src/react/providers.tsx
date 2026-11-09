'use client';

// What an app's root layout mounts, once: a TanStack Query client, the one `ApiClient` every screen
// calls the platform through, and — when the layout minted a socket token — the realtime stream.
//
// The access token is seeded here from whatever the Server Component layout resolved, so the first
// query of the first render already carries an Authorization header; a client that discovered its
// token in an effect would send every initial request unauthenticated and then refresh.
import {
  createApiClient,
  createRouteHandlerRefresh,
  createTokenStore,
  type ApiClient,
  type AuthSession,
} from '@komtru/api-client';
import {
  ApiClientProvider,
  RealtimeProvider,
  retryProblemAware,
  type SocketFactory,
} from '@komtru/api-client/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { AppConfig } from '../config.js';

/**
 * Reads retry once, for the whole app: a problem a repeat can fix is retried, and one it cannot —
 * a 422, a 403, a reused idempotency key — is surfaced straight away rather than three times.
 * `idempotent: true` because these are TanStack *queries*; mutations declare their own.
 */
export function createKomtruQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: retryProblemAware({ idempotent: true }),
        // The platform is the source of truth and the socket says when to re-read it, so a
        // window focus is not itself news. 30s keeps a tab switch from refetching the world.
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export interface KomtruProvidersProps {
  config: Pick<AppConfig, 'apiUrl' | 'socketUrl'>;
  /** Resolved by the Server Component layout from the refresh cookie; `null` before sign-in. */
  session: AuthSession | null;
  /** The short-lived, socket-scoped token the layout minted (socket guide §6). */
  socketToken?: string;
  /**
   * Connect the socket as whoever the app is signed in as, using the access token the HTTP client already
   * holds, and forward each refreshed one. For an app whose layout cannot mint a socket token because its
   * refresh cookie is not readable to a page (the platform authenticates a socket with the same access token
   * as HTTP). Until the first call has produced a session there is nobody to connect as, so no socket yet.
   * Ignored when `socketToken` is given.
   */
  socketFollowsSession?: boolean;
  /** Invalidated on every reconnect. Omit to invalidate everything, which is the safe default. */
  resyncQueryKeys?: readonly (readonly unknown[])[];
  /**
   * Called when a refresh comes back `null` — the refresh cookie is gone or the family was revoked.
   * The app decides what that looks like; `app-kit` will not navigate on an app's behalf.
   */
  onSessionEnded?: () => void;
  queryClient?: QueryClient;
  /** Injected by tests; the default lazily imports socket.io-client inside the effect. */
  connect?: SocketFactory;
  children: ReactNode;
}

interface KomtruContextValue {
  client: ApiClient;
  session: AuthSession | null;
}

const KomtruContext = createContext<KomtruContextValue | null>(null);

export function KomtruProviders({
  config,
  session,
  socketToken,
  socketFollowsSession = false,
  resyncQueryKeys,
  onSessionEnded,
  queryClient,
  connect,
  children,
}: KomtruProvidersProps) {
  const [queries] = useState(() => queryClient ?? createKomtruQueryClient());

  // Built in the initialiser, not an effect: the token is in the store before any child renders,
  // and the client survives every re-render of this component.
  const [client] = useState<ApiClient>(() => {
    const tokens = createTokenStore({
      // The route handler is the only thing that can read the httpOnly refresh cookie, which is
      // why the refresh is same-origin and not a call to the backend.
      refresh: createRouteHandlerRefresh(),
      ...(onSessionEnded ? { onSessionEnded } : {}),
    });
    if (session !== null) tokens.set(session);
    return createApiClient({ baseUrl: config.apiUrl, tokens });
  });

  /**
   * Keeps the token store in step with what the server last said. The App Router pattern after a
   * sign-in or a sign-out is `router.refresh()`, which re-renders this layout with a different
   * `session` — and without this the store would keep the token it was seeded with: `useSession()`
   * would say signed out while `useApiClient()` carried on calling the platform with a token good
   * for another ten minutes.
   *
   * Compared by access token, not by identity, so a layout that re-renders with an equivalent
   * object does not overwrite a token the client refreshed in the meantime.
   */
  const applied = useRef<string | null>(session?.accessToken ?? null);
  useEffect(() => {
    const next = session?.accessToken ?? null;
    if (next === applied.current) return;
    applied.current = next;
    client.tokens?.set(session);
  }, [client, session]);

  const value = useMemo<KomtruContextValue>(() => ({ client, session }), [client, session]);

  // The access token the client holds right now. It is empty until the first request has refreshed a session,
  // and whenever signed out; the realtime provider connects only while it is not.
  const heldToken = useSyncExternalStore(
    (listener) => client.tokens?.subscribe(listener) ?? (() => undefined),
    () => client.tokens?.session()?.accessToken ?? '',
    () => '',
  );
  // The gateway asks for a fresh token when the one it has lapses. The HTTP client refreshes lazily, so a screen
  // that only listens would never make the request that does it; this is that request.
  const refreshSocketToken = useCallback(async (): Promise<string | null> => {
    const tokens = client.tokens;
    if (tokens === undefined) return null;
    const next = await tokens.refreshOnce(tokens.read().generation);
    return next.accessToken;
  }, [client]);
  const follow = socketToken === undefined && socketFollowsSession;
  const liveToken = socketToken ?? (follow ? heldToken : undefined);

  // The same client under both contexts: `@komtru/api-client/react`'s hooks (`useAddresses`, `useStates`,
  // the trade hooks) read `ApiClientProvider`, and this package's `useApiClient` reads `KomtruContext`.
  // Without the inner provider an app could call one family of hooks or the other, never both.
  const tree = (
    <KomtruContext.Provider value={value}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </KomtruContext.Provider>
  );

  return (
    <QueryClientProvider client={queries}>
      {liveToken === undefined || (!follow && liveToken === '') || config.socketUrl === undefined ? (
        tree
      ) : (
        // When following the session this stays mounted (with an empty token) from the first render, so the app's
        // tree is never remounted when the first token arrives: the provider simply connects then.
        <RealtimeProvider
          token={liveToken}
          refreshToken={refreshSocketToken}
          url={config.socketUrl}
          {...(resyncQueryKeys ? { resyncQueryKeys } : {})}
          {...(connect ? { connect } : {})}
        >
          {tree}
        </RealtimeProvider>
      )}
    </QueryClientProvider>
  );
}

const useKomtru = (): KomtruContextValue => {
  const value = useContext(KomtruContext);
  if (value === null) {
    throw new Error('useApiClient and useSession must be used inside <KomtruProviders>');
  }
  return value;
};

export const useApiClient = (): ApiClient => useKomtru().client;

/** Whatever the layout knew at render time. The 401 is still the truth. */
export const useSession = (): AuthSession | null => useKomtru().session;
