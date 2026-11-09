'use client';

import { captureException } from '@sentry/nextjs';
import { useApiClient } from '@komtru/app-kit/react';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { clearOfflineCache } from '../../shell/ServiceWorker';
import { clearEntryDrafts } from '../drafts';
import { afterSession } from '../flow';
import type { Opened } from '../session-calls';

/**
 * What every screen that opens a session does next: hand the access token to the API client, forget
 * what the way in remembered, and go where the platform says the person is owed.
 *
 * The offline cache goes too. It is per origin, not per person, and on a shared phone the pages
 * saved there belong to whoever signed in last — who may not have signed out.
 */
export function useOpenSession(next: string | undefined): (opened: Opened) => Promise<void> {
  const client = useApiClient();
  const router = useRouter();

  return useCallback(
    async (opened: Opened) => {
      client.tokens?.set(opened.session);
      clearEntryDrafts();
      await clearOfflineCache().catch((error: unknown) => {
        captureException(error);
      });
      // `replace`: the screen that asked for the code is not somewhere to come back to.
      router.replace(afterSession(opened.nextStep, next));
    },
    [client, router, next],
  );
}
