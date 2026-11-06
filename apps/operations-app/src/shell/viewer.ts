'use client';

import { getStaffMe, type StaffMe } from '@komtru/api-client';
import { useApiClient } from '@komtru/app-kit/react';
import { useQuery } from '@tanstack/react-query';
import { permissionSet, type PermissionCode } from './permissions';

/** Who the console is being drawn for. The empty viewer holds nothing, so it is shown nothing. */
export interface StaffViewer {
  me: StaffMe | undefined;
  permissions: ReadonlySet<PermissionCode>;
  /** The platform has not answered yet. */
  loading: boolean;
  /** The platform answered, but not with a staff member: no route, no session, no permission. */
  failed: boolean;
}

export const viewerFrom = (me: StaffMe | undefined, loading: boolean, failed: boolean): StaffViewer => ({
  me,
  permissions: permissionSet(me?.permissions ?? []),
  loading,
  failed,
});

export const STAFF_ME_KEY = ['staff', 'me'] as const;

/**
 * The signed-in staff member, from `GET /admin/me`. A missing route (the backend has none yet), an
 * expired session and a person with no role all end the same way, with no permissions: the sidebar
 * is empty and each section says it is not theirs. Failing closed is the point.
 */
export function useStaffViewer(): StaffViewer & { retry: () => void } {
  const client = useApiClient();
  const query = useQuery({
    queryKey: STAFF_ME_KEY,
    queryFn: () => client.call(getStaffMe, {}),
    // A 404 or 403 is an answer, not a blip; the client's own retry handles the ones a repeat fixes.
    staleTime: 60_000,
  });
  return {
    ...viewerFrom(query.data, query.isPending, query.isError),
    retry: () => {
      void query.refetch();
    },
  };
}
