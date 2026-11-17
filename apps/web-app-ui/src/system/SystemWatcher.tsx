'use client';

import { ProblemError } from '@komtru/api-client';
import { WarnBanner } from '@komtru/ui-kit';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export const UPDATE_REQUIRED_HREF = '/update-required';
export const STATUS_HREF = '/status';

/**
 * What takes someone to the two system states no screen of their own reaches (SP-M14, SP-M15). It listens to every read
 * and every change the app makes, and says nothing until the platform says one of two things:
 *
 * - 426 Upgrade Required: this version of the app is no longer supported, so go to SP-M15. The platform sends no 426
 *   today (it has no minimum version), so this is wired and waiting rather than live.
 * - 503 Service Unavailable: the platform, or a service it depends on (the payment provider), is down. A strip appears
 *   linking to SP-M14, and goes when the next read succeeds. It does not take the person off the screen they are on.
 */
export function SystemWatcher(): React.JSX.Element | null {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const heard = (error: unknown): void => {
      if (!(error instanceof ProblemError)) return;
      if (error.status === 426) router.replace(UPDATE_REQUIRED_HREF);
      else if (error.status === 503) setUnavailable(true);
    };
    const stopQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      if (event.action.type === 'error') heard(event.action.error);
      else if (event.action.type === 'success') setUnavailable(false);
    });
    const stopMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') heard(event.action.error);
    });
    return () => {
      stopQueries();
      stopMutations();
    };
  }, [queryClient, router]);

  if (!unavailable) return null;
  return (
    <div className="mx-auto w-full max-w-[480px] px-[16px] pt-[8px]">
      <WarnBanner title="Komtru is having trouble">
        Some things may be slow or unavailable.{' '}
        <a href={STATUS_HREF} className="font-semibold text-info-on-soft">
          See what’s happening
        </a>
      </WarnBanner>
    </div>
  );
}
