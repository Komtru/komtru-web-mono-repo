'use client';

import { KomtruProviders } from '@komtru/app-kit/react';
import { readAppConfig } from '@komtru/app-kit';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
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
  const config = readAppConfig(appSpec, webAppEnv());

  const onSessionEnded = useCallback(() => {
    // Everything this device saved belonged to the person whose session just ended. The Cache API
    // is per origin, not per person, and the phone at a motor park counter is a shared phone — so
    // the pages go before the next person reaches the sign-in screen.
    void clearOfflineCache().finally(() => {
      // `replace`, not `push`: a dead session is not somewhere to go back to.
      router.replace(appSpec.signInPath);
    });
  }, [router]);

  return (
    <KomtruProviders
      config={{ apiUrl: config.apiUrl, socketUrl: config.socketUrl }}
      // T-111 resolves the real session in the layout from the refresh cookie. Until the entry
      // screens exist there is nothing to resolve, and `null` is the honest answer rather than a
      // placeholder token every query would fail with.
      session={null}
      onSessionEnded={onSessionEnded}
    >
      {children}
    </KomtruProviders>
  );
}
