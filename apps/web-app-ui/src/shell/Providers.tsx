'use client';

import { captureException } from '@sentry/nextjs';

import { createKomtruQueryClient, KomtruProviders } from '@komtru/app-kit/react';
import { readAppConfig } from '@komtru/app-kit';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { appSpec, webAppEnv } from '../app-config';
import { clearOfflineCache } from './ServiceWorker';

/**
 * The client half of the root layout: one TanStack Query client, one `ApiClient`, and the decision
 * `@komtru/app-kit` refuses to make for an app — what a session ending looks like.
 *
 * It reads its own environment rather than taking it from the layout. These are `NEXT_PUBLIC_*`
 * values, which Next inlines into this bundle one literal at a time, so this is where they actually
 * come from; threading them through a Server Component only moved the read to build time.
 */
export function Providers({ children }: { children: React.ReactNode }): React.JSX.Element {
  const router = useRouter();
  // Held here so a session ending can empty it: the next person on this device must not be handed
  // the previous person's cached trades from memory.
  const [queries] = useState(createKomtruQueryClient);
  const config = readAppConfig(appSpec, webAppEnv());

  const onSessionEnded = useCallback(() => {
    // The previous person's cached trades must not be handed to the next one from memory.
    queries.clear();
    // Everything this device saved belonged to the person whose session just ended. The Cache API
    // is per origin, not per person, and the phone at a motor park counter is a shared phone — so
    // the pages go before the next person reaches the sign-in screen.
    void clearOfflineCache()
      // Reported, never swallowed: a sign-out that left the last person's pages on a shared phone
      // is the one failure in this path worth knowing about. It must not block the redirect
      // either — leaving someone signed in on screen because a cache write failed is worse.
      .catch((error: unknown) => {
        captureException(error);
      })
      .finally(() => {
        // `replace`, not `push`: a dead session is not somewhere to go back to.
        router.replace(appSpec.signInPath);
      });
  }, [router, queries]);

  return (
    <KomtruProviders
      config={{ apiUrl: config.apiUrl, socketUrl: config.socketUrl }}
      // `null` at first paint on purpose. The refresh cookie is scoped to `/api/auth`, so no page can
      // read it: the first call goes out without a token, gets its 401, and the client refreshes
      // through the same-origin route handler and retries. The entry screens hand the client the
      // token directly the moment sign-in or a verified code opens the session (T-111).
      session={null}
      // The refresh cookie is not readable to a page, so the layout cannot mint a socket token. The socket connects
      // as the access token the client already holds, once the first request has produced one.
      socketFollowsSession
      onSessionEnded={onSessionEnded}
      queryClient={queries}
    >
      {children}
    </KomtruProviders>
  );
}
