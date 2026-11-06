'use client';

// `useAddresses()` and the four address mutations (T-042). Every mutation refreshes the list, because
// one change can touch several rows: making a default clears another, archiving the default promotes
// the next one.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Address, CreateAddressBody, UpdateAddressBody } from '@komtru/shared-types';
import {
  archiveAddress,
  createAddress,
  fetchAllAddresses,
  makeDefaultAddress,
  updateAddress,
} from '../addresses.js';
import type { ApiClient } from '../client.js';
import { useApiClient } from './client-context.js';

export const addressKeys = {
  all: ['me', 'addresses'] as const,
};

export const addressesQueryOptions = (client: ApiClient) => ({
  queryKey: addressKeys.all,
  queryFn: ({ signal }: { signal: AbortSignal }): Promise<Address[]> => fetchAllAddresses(client, signal),
});

/** The signed-in buyer's live addresses, default first. */
export function useAddresses() {
  const client = useApiClient();
  return useQuery(addressesQueryOptions(client));
}

function useAddressMutation<TVariables>(
  call: (client: ApiClient, variables: TVariables) => Promise<Address>,
) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: TVariables) => call(client, variables),
    onSettled: () => queryClient.invalidateQueries({ queryKey: addressKeys.all }),
  });
}

export const useCreateAddress = () =>
  useAddressMutation((client, body: CreateAddressBody) => client.call(createAddress, { body }));

export const useUpdateAddress = () =>
  useAddressMutation((client, { id, ...body }: { id: string } & UpdateAddressBody) =>
    client.call(updateAddress, { params: { id }, body }),
  );

export const useArchiveAddress = () =>
  useAddressMutation((client, id: string) => client.call(archiveAddress, { params: { id } }));

export const useMakeDefaultAddress = () =>
  useAddressMutation((client, id: string) => client.call(makeDefaultAddress, { params: { id } }));
