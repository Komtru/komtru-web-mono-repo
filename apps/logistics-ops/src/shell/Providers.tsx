'use client';

import { captureException } from '@sentry/nextjs';
import { KomtruProviders } from '@komtru/app-kit/react';
import { publicEnv, readAppConfig } from '@komtru/app-kit';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { appSpec } from '../app-config';

/**
 * One TanStack Query client, one `ApiClient`, and the decision `@komtru/app-kit` refuses to make
 * for an app: what a session ending looks like. Here it is the sign-in screen.
 *
 * The session is `null` at first paint on purpose. The refresh cookie is scoped to `/api/auth`, so
 * a page cannot read it; the first API call goes out without a token, gets its 401, and the client
 * refreshes through the same-origin route handler and retries. `<PortalFrame>` waits for the
 * person's company and role before it draws anything that depends on them.
 */
export function Providers({ children }: { children: React.ReactNode }): React.JSX.Element {
  const router = useRouter();
  const config = readAppConfig(appSpec, publicEnv());

  const onSessionEnded = useCallback(() => {
    try {
      // `replace`, not `push`: a dead session is not somewhere to go back to.
      router.replace(appSpec.signInPath);
    } catch (error) {
      captureException(error);
    }
  }, [router]);

  return (
    <KomtruProviders
      config={{ apiUrl: config.apiUrl, socketUrl: config.socketUrl }}
      session={null}
      onSessionEnded={onSessionEnded}
    >
      {children}
    </KomtruProviders>
  );
}
