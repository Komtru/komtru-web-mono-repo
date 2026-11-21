'use client';

import { getLogisticsMe, type LogisticsMe } from '@komtru/api-client';
import { useApiClient } from '@komtru/app-kit/react';
import { useQuery } from '@tanstack/react-query';

export const LOGISTICS_ME_KEY = ['logistics', 'me'] as const;

export interface LogisticsViewer {
  me: LogisticsMe | undefined;
  isAdmin: boolean;
  loading: boolean;
  /** The platform answered, but not with a member: no session, or no company any more. */
  failed: boolean;
  retry: () => void;
}

/**
 * The signed-in member: their company and role, from `GET /logistics/me`, which the backend resolves
 * from the session on every call. A removed member gets a 403 here and sees nothing of the company:
 * failing closed is the point. Admin-only controls read `isAdmin`; the backend still decides.
 */
export function useLogisticsViewer(): LogisticsViewer {
  const client = useApiClient();
  const query = useQuery({
    queryKey: LOGISTICS_ME_KEY,
    queryFn: () => client.call(getLogisticsMe, {}),
    staleTime: 30_000,
  });
  return {
    me: query.data,
    isAdmin: query.data?.member.role === 'ADMIN',
    loading: query.isPending,
    failed: query.isError,
    retry: () => {
      void query.refetch();
    },
  };
}
