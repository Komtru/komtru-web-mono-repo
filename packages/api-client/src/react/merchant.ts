'use client';

// The applicant's half of merchant certification (T-121): the application as the person sees it, and the
// three calls that change it. Saving a draft and submitting both answer with the whole application, so the
// cache takes that answer rather than refetching.
//
// A draft holds a registered address, a CAC number and document ids, so the mutations drop their variables
// with `gcTime: 0`, the way the address mutations do.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from '../client.js';
import type { EndpointInput } from '../contracts.js';
import {
  getMyMerchantApplication,
  resubmitMerchantApplication,
  saveMerchantDraft,
  submitMerchantApplication,
  type MerchantApplication,
} from '../merchant.js';
import { useApiClient } from './client-context.js';

export const merchantKeys = {
  application: ['me', 'merchant', 'application'] as const,
};

export const merchantApplicationQueryOptions = (client: ApiClient) => ({
  queryKey: merchantKeys.application,
  queryFn: ({ signal }: { signal: AbortSignal }): Promise<MerchantApplication | null> =>
    client.call(getMyMerchantApplication, {}, { signal }),
});

/** The person's application, or `null` before they have started one. */
export function useMyMerchantApplication() {
  const client = useApiClient();
  return useQuery(merchantApplicationQueryOptions(client));
}

export type MerchantDraftBody = EndpointInput<typeof saveMerchantDraft>['body'];

/** Saves the fields that are sent; the server keeps the rest of the draft. */
export function useSaveMerchantDraft() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MerchantDraftBody) => client.call(saveMerchantDraft, { body }),
    gcTime: 0,
    onSuccess: (application) => queryClient.setQueryData(merchantKeys.application, application),
  });
}

function useApplicationCall(call: (client: ApiClient, id: string) => Promise<MerchantApplication>) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => call(client, id),
    gcTime: 0,
    onSuccess: (application) => queryClient.setQueryData(merchantKeys.application, application),
  });
}

/** Sends the application for review. Refused (422) until every required field and document is there. */
export const useSubmitMerchantApplication = () =>
  useApplicationCall((client, id) => client.call(submitMerchantApplication, { params: { id }, body: {} }));

/** Sends a corrected application back after staff asked for changes. */
export const useResubmitMerchantApplication = () =>
  useApplicationCall((client, id) => client.call(resubmitMerchantApplication, { params: { id }, body: {} }));
