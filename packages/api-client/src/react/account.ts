'use client';

// Account security and lifecycle (F-045, T-205), over `../account.ts`. Reads sit under `accountKeys.all`, so a change that
// moves one (a factor added, a device retired) refreshes what it touches with one invalidation. The seed, the backup
// codes and the step-up token pass through a mutation's result and are never put in a query cache a later screen could
// read: a screen holds them in its own state and drops them when it is done.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  activateSms,
  activateOwnTotp,
  closeAccount,
  enrolSms,
  enrolOwnTotp,
  getMe,
  getVerificationStatus,
  listDevices,
  listFactors,
  listSessions,
  regenerateRecoveryCodes,
  removeFactor,
  requestDataExport,
  requestErasure,
  retireDevice,
  revokeSession,
  stepUp,
  stepUpChallenge,
  submitBvn,
  submitLiveness,
  submitNin,
  trustDevice,
  type CloseAccountBody,
  type StepUpBody,
  type SubmitBvnBody,
  type SubmitNinBody,
} from '../account.js';
import { useApiClient } from './client-context.js';

/** One page of this size is every factor, device and session a person realistically has. */
const LIST_LIMIT = 50;

export const accountKeys = {
  all: ['me', 'account'] as const,
  me: ['me', 'account', 'me'] as const,
  factors: ['me', 'account', 'factors'] as const,
  devices: ['me', 'account', 'devices'] as const,
  sessions: ['me', 'account', 'sessions'] as const,
  verification: ['me', 'account', 'verification'] as const,
};

/** The profile summary and the state of the account (AS1, AS2, CA1, CA2). */
export function useMe() {
  const client = useApiClient();
  return useQuery({
    queryKey: accountKeys.me,
    queryFn: ({ signal }) => client.call(getMe, {}, { signal }),
  });
}

export function useFactors() {
  const client = useApiClient();
  return useQuery({
    queryKey: accountKeys.factors,
    queryFn: async ({ signal }) =>
      (await client.call(listFactors, { query: { limit: LIST_LIMIT } }, { signal })).items,
  });
}

export function useDevices() {
  const client = useApiClient();
  return useQuery({
    queryKey: accountKeys.devices,
    queryFn: async ({ signal }) =>
      (await client.call(listDevices, { query: { limit: LIST_LIMIT } }, { signal })).items,
  });
}

export function useSessions() {
  const client = useApiClient();
  return useQuery({
    queryKey: accountKeys.sessions,
    queryFn: async ({ signal }) =>
      (await client.call(listSessions, { query: { limit: LIST_LIMIT } }, { signal })).items,
  });
}

/** The level, what is still required, what is in flight, and the structured reason for each rejection (VF1). */
export function useVerificationStatus() {
  const client = useApiClient();
  return useQuery({
    queryKey: accountKeys.verification,
    queryFn: ({ signal }) => client.call(getVerificationStatus, {}, { signal }),
  });
}

/** A mutation that refreshes everything account-shaped once it settles, success or not. */
function useAccountMutation<TVariables, TData>(mutationFn: (variables: TVariables) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: accountKeys.all }),
  });
}

export function useEnrolTotp() {
  const client = useApiClient();
  return useMutation({ mutationFn: () => client.call(enrolOwnTotp, {}) });
}

export function useActivateTotp() {
  const client = useApiClient();
  return useAccountMutation((body: { factorId: string; code: string }) =>
    client.call(activateOwnTotp, { body }),
  );
}

export function useEnrolSms() {
  const client = useApiClient();
  return useMutation({ mutationFn: () => client.call(enrolSms, {}) });
}

export function useActivateSms() {
  const client = useApiClient();
  return useAccountMutation((body: { factorId: string; challengeId: string; code: string }) =>
    client.call(activateSms, { body }),
  );
}

export function useRegenerateRecoveryCodes() {
  const client = useApiClient();
  return useAccountMutation((stepUpToken: string) =>
    client.call(regenerateRecoveryCodes, { body: { stepUpToken } }),
  );
}

export function useRemoveFactor() {
  const client = useApiClient();
  return useAccountMutation((variables: { id: string; stepUpToken: string }) =>
    client.call(removeFactor, { params: { id: variables.id }, body: { stepUpToken: variables.stepUpToken } }),
  );
}

export function useStepUpChallenge() {
  const client = useApiClient();
  return useMutation({
    mutationFn: (factorId: string) => client.call(stepUpChallenge, { body: { factorId } }),
  });
}

/** Proves it is you for a sensitive action. The token comes back to the caller only. */
export function useStepUp() {
  const client = useApiClient();
  return useMutation({ mutationFn: (body: StepUpBody) => client.call(stepUp, { body }) });
}

export function useRetireDevice() {
  const client = useApiClient();
  return useAccountMutation((id: string) => client.call(retireDevice, { params: { id } }));
}

export function useTrustDevice() {
  const client = useApiClient();
  return useAccountMutation((id: string) => client.call(trustDevice, { params: { id } }));
}

export function useRevokeSession() {
  const client = useApiClient();
  return useAccountMutation((id: string) => client.call(revokeSession, { params: { id } }));
}

/** CA2. On success every session is revoked, this one included: the screen signs this device out. */
export function useCloseAccount() {
  const client = useApiClient();
  return useMutation({ mutationFn: (body: CloseAccountBody) => client.call(closeAccount, { body }) });
}

export function useRequestDataExport() {
  const client = useApiClient();
  return useMutation({ mutationFn: () => client.call(requestDataExport, {}) });
}

export function useRequestErasure() {
  const client = useApiClient();
  return useMutation({ mutationFn: (body: CloseAccountBody) => client.call(requestErasure, { body }) });
}

export function useSubmitNin() {
  const client = useApiClient();
  return useAccountMutation((body: SubmitNinBody) => client.call(submitNin, { body }));
}

export function useSubmitBvn() {
  const client = useApiClient();
  return useAccountMutation((body: SubmitBvnBody) => client.call(submitBvn, { body }));
}

export function useSubmitLiveness() {
  const client = useApiClient();
  return useAccountMutation((selfieFileId: string) =>
    client.call(submitLiveness, { body: { selfieFileId } }),
  );
}
