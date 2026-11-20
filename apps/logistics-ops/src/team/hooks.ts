'use client';

// The queries and mutations behind the Team screen. Every call is the portal's own: the backend scopes
// each one to the caller's company from the session, and none of them names a company. A change, won
// or lost, marks the roster stale, so a 409 caused by someone else's edit is followed by the truth.
import {
  cancelLogisticsInvitation,
  inviteLogisticsMember,
  listLogisticsInvitations,
  listLogisticsMembers,
  updateLogisticsMember,
  type LogisticsRole,
} from '@komtru/api-client';
import { useApiClient } from '@komtru/app-kit/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LOGISTICS_ME_KEY } from '../shell/viewer';

/** A courier team is a handful of people; one page of the backend's maximum holds any real one. */
const LIMIT = 100;

export const teamKeys = {
  all: ['logistics', 'team'] as const,
  members: ['logistics', 'team', 'members'] as const,
  invitations: ['logistics', 'team', 'invitations'] as const,
};

export function useTeam() {
  const client = useApiClient();
  const members = useQuery({
    queryKey: teamKeys.members,
    queryFn: () => client.call(listLogisticsMembers, { query: { limit: LIMIT } }),
  });
  const invitations = useQuery({
    queryKey: teamKeys.invitations,
    queryFn: () => client.call(listLogisticsInvitations, { query: { limit: LIMIT } }),
  });
  return { members, invitations };
}

export function useTeamMutations() {
  const client = useApiClient();
  const queries = useQueryClient();
  const settle = async (): Promise<void> => {
    await queries.invalidateQueries({ queryKey: teamKeys.all });
    // A change to your own role changes what this screen shows you.
    await queries.invalidateQueries({ queryKey: LOGISTICS_ME_KEY });
  };

  const invite = useMutation({
    mutationFn: (input: ({ email: string } | { phone: string }) & { role: LogisticsRole }) =>
      client.call(inviteLogisticsMember, { body: input }),
    onSettled: settle,
  });
  const changeRole = useMutation({
    mutationFn: (input: { id: string; role: LogisticsRole }) =>
      client.call(updateLogisticsMember, { params: { id: input.id }, body: { role: input.role } }),
    onSettled: settle,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      client.call(updateLogisticsMember, { params: { id }, body: { status: 'REMOVED' } }),
    onSettled: settle,
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => client.call(cancelLogisticsInvitation, { params: { id } }),
    onSettled: settle,
  });
  return { invite, changeRole, remove, withdraw };
}
