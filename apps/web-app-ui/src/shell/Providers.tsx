'use client';

import { KomtruProviders } from '@komtru/app-kit/react';
import { useRouter } from 'next/navigation';
import type { WebAppConfig } from '../app-config';

/**
 * The client half of the root layout: one TanStack Query client, one `ApiClient`, and the decision
 * `@komtru/app-kit` refuses to make for an app — what a session ending looks like.
 *
 * It exists because `onSessionEnded` is a function, and a function cannot be handed from a Server
 * Component to a client one as a prop. The config can, so the layout reads the environment at the
 * server boundary and this only passes it on.
 */
export function Providers({
  config,
  children,
}: {
  config: Pick<WebAppConfig, 'apiUrl' | 'socketUrl' | 'signInPath'>;
  children: React.ReactNode;
}): React.JSX.Element {
  const router = useRouter();

  return (
    <KomtruProviders
      config={{ apiUrl: config.apiUrl, socketUrl: config.socketUrl }}
      // T-111 resolves the real session in the layout from the refresh cookie. Until the entry
      // screens exist there is nothing to resolve, and `null` is the honest answer rather than a
      // placeholder token every query would fail with.
      session={null}
      onSessionEnded={() => {
        // `replace`, not `push`: a dead session is not somewhere to go back to.
        router.replace(config.signInPath);
      }}
    >
      {children}
    </KomtruProviders>
  );
}
