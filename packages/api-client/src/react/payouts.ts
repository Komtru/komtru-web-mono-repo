'use client';

// Getting paid out (T-124, over T-073's routes): the seller's balance, payouts, payout accounts and how they are
// paid. Every number on these screens is the platform's; nothing here computes one. Everything sits under
// `payoutKeys.all`, so a change that moves money can refresh every money screen with one invalidation.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PayoutMode } from '@komtru/shared-types';
import {
  addPayoutAccount,
  getPayout,
  getPayoutPreference,
  getPayoutSummary,
  listBanks,
  listPayoutAccounts,
  listPayouts,
  removePayoutAccount,
  requestPayout,
  setDefaultPayoutAccount,
  setPayoutPreference,
  type Payout,
  type PayoutAccount,
} from '../payouts.js';
import { nextPageParam } from '../pagination.js';
import { ProblemError } from '../problems.js';
import { useApiClient } from './client-context.js';

/** How often a payout on its way, or an account being checked with the bank, is asked about again. */
export const PAYOUT_POLL_MS = 5000;

const PAYOUT_PAGE = 20;

export const payoutKeys = {
  all: ['me', 'payouts'] as const,
  summary: ['me', 'payouts', 'summary'] as const,
  list: ['me', 'payouts', 'list'] as const,
  one: (id: string) => ['me', 'payouts', 'one', id] as const,
  accounts: ['me', 'payouts', 'accounts'] as const,
  preference: ['me', 'payouts', 'preference'] as const,
  /** Reference data, not the seller's: outside `all`, so a money change never refetches the bank list. */
  banks: ['payouts', 'banks'] as const,
};

/** REQUESTED and PROCESSING are on their way; every other status is the platform's settled answer. */
export const isPayoutInFlight = (payout: Pick<Payout, 'status'>): boolean =>
  payout.status === 'REQUESTED' || payout.status === 'PROCESSING';

/**
 * The available balance, what is on its way, the fee a withdrawal now pays, the mode and any hold. Polled while money
 * is on its way (a failed payout returns it to the balance), and only then.
 */
export function usePayoutSummary() {
  const client = useApiClient();
  return useQuery({
    queryKey: payoutKeys.summary,
    queryFn: ({ signal }) => client.call(getPayoutSummary, {}, { signal }),
    refetchInterval: (query) =>
      query.state.data !== undefined && BigInt(query.state.data.inFlightMinor) > 0n ? PAYOUT_POLL_MS : false,
  });
}

/**
 * The seller's payouts, newest first. A stale cursor (422) resets the list to its first page. Polled while any loaded
 * payout is on its way, so its row settles without a reload, and only then.
 */
export function usePayouts() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useInfiniteQuery({
    queryKey: payoutKeys.list,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPageParam,
    queryFn: async ({ pageParam, signal }) => {
      try {
        return await client.call(
          listPayouts,
          { query: { limit: PAYOUT_PAGE, ...(pageParam === undefined ? {} : { cursor: pageParam }) } },
          { signal },
        );
      } catch (error) {
        if (pageParam !== undefined && error instanceof ProblemError && error.status === 422) {
          void queryClient.resetQueries({ queryKey: payoutKeys.list });
        }
        throw error;
      }
    },
    // After `queryFn`, so the page type is inferred from it rather than from this callback.
    refetchInterval: (query: { state: { data?: { pages: { items: Payout[] }[] } } }) =>
      query.state.data?.pages.some((page) => page.items.some(isPayoutInFlight)) === true
        ? PAYOUT_POLL_MS
        : false,
  });
}

/** One payout (PR1, WF1). Polled while it is on its way, and only then. */
export function usePayout(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: payoutKeys.one(id),
    queryFn: ({ signal }) => client.call(getPayout, { params: { id } }, { signal }),
    refetchInterval: (query) =>
      query.state.data !== undefined && isPayoutInFlight(query.state.data) ? PAYOUT_POLL_MS : false,
  });
}

/** The seller's live accounts (removed ones are not sent). Polled while one is still being checked. */
export function usePayoutAccounts() {
  const client = useApiClient();
  return useQuery({
    queryKey: payoutKeys.accounts,
    queryFn: async ({ signal }): Promise<PayoutAccount[]> =>
      (await client.call(listPayoutAccounts, {}, { signal })).accounts,
    refetchInterval: (query) =>
      query.state.data?.some((account) => account.status === 'PENDING_VERIFICATION') === true
        ? PAYOUT_POLL_MS
        : false,
  });
}

export function usePayoutPreference() {
  const client = useApiClient();
  return useQuery({
    queryKey: payoutKeys.preference,
    queryFn: ({ signal }) => client.call(getPayoutPreference, {}, { signal }),
  });
}

/** The banks a seller can be paid into. Reference data the platform caches; read once per session. */
export function useBanks() {
  const client = useApiClient();
  return useQuery({
    queryKey: payoutKeys.banks,
    queryFn: async ({ signal }) => (await client.call(listBanks, {}, { signal })).banks,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** An account change can move the default, which the summary and the preference both name. */
function useAccountMutation<TVariables>(call: (variables: TVariables) => Promise<PayoutAccount>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: call,
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: payoutKeys.accounts }),
        queryClient.invalidateQueries({ queryKey: payoutKeys.summary }),
        queryClient.invalidateQueries({ queryKey: payoutKeys.preference }),
      ]);
    },
  });
}

/** 202: stored PENDING_VERIFICATION and checked with the bank; the list polls until it is decided. */
export function useAddPayoutAccount() {
  const client = useApiClient();
  return useAccountMutation((body: { bankCode: string; accountNumber: string }) =>
    client.call(addPayoutAccount, { body }),
  );
}

export function useSetDefaultPayoutAccount() {
  const client = useApiClient();
  return useAccountMutation((id: string) => client.call(setDefaultPayoutAccount, { params: { id } }));
}

export function useRemovePayoutAccount() {
  const client = useApiClient();
  return useAccountMutation((id: string) => client.call(removePayoutAccount, { params: { id } }));
}

export function useSetPayoutPreference() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mode: PayoutMode) => client.call(setPayoutPreference, { body: { mode } }),
    onSuccess: (answer) => {
      queryClient.setQueryData(payoutKeys.preference, answer);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: payoutKeys.summary }),
  });
}

export interface RequestPayoutVariables {
  body: { amountMinor: string; payoutAccountId?: string };
  /**
   * Held by the screen for one withdrawal the seller asked for, and sent again by its "try again": a double tap or
   * a retry after a lost answer is then one payout, not two.
   */
  idempotencyKey: string;
}

/** Withdraw (AB5). The payout is stored under its own key, and the balance and history are read again. */
export function useRequestPayout() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: RequestPayoutVariables) =>
      client.call(requestPayout, { body }, { idempotencyKey }),
    onSuccess: (payout) => {
      queryClient.setQueryData(payoutKeys.one(payout.id), payout);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: payoutKeys.summary }),
        queryClient.invalidateQueries({ queryKey: payoutKeys.list }),
      ]);
    },
  });
}
