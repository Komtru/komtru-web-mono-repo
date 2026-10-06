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
import { RealtimeProvider, retryProblemAware, type SocketFactory } from '@komtru/api-client/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
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

  const value = useMemo<KomtruContextValue>(() => ({ client, session }), [client, session]);

  const tree = <KomtruContext.Provider value={value}>{children}</KomtruContext.Provider>;

  return (
    <QueryClientProvider client={queries}>
      {socketToken === undefined || socketToken === '' || config.socketUrl === undefined ? (
        tree
      ) : (
        <RealtimeProvider
          token={socketToken}
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
