'use client';

// Cancelling a funded trade and getting a refund (T-119, over T-066's and T-075's routes): CR1–CR3, SC1, SC2.
// Every read about a trade sits under `tradeKeys.one(id)`, so a cancellation answer refetches the trade, its
// cancellation and its refunds with one invalidation. Nothing here computes an amount: the refund on screen is
// the ledger's own row.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BuyerCancellationReason, SellerCancellationReason } from '@komtru/shared-types';
import { nextPageParam } from '../pagination.js';
import { ProblemError } from '../problems.js';
import {
  approveCancellation,
  cancelAsSeller,
  declineCancellation,
  getCancellation,
  isRefundInFlight,
  listMyRefunds,
  listTradeRefunds,
  requestCancellation,
} from '../refunds.js';
import { useApiClient } from './client-context.js';
import { tradeKeys } from './trades.js';

/** How often a refund on its way back to the buyer is asked about again. */
export const REFUND_POLL_MS = 5000;

const REFUND_PAGE = 20;

export const refundKeys = {
  cancellation: (tradeId: string) => [...tradeKeys.one(tradeId), 'cancellation'] as const,
  forTrade: (tradeId: string) => [...tradeKeys.one(tradeId), 'refunds'] as const,
  mine: ['me', 'refunds'] as const,
};

/** The trade's cancellation request and what the reader may do now (CR1, CR2, SC1). */
export function useCancellation(tradeId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: refundKeys.cancellation(tradeId),
    queryFn: ({ signal }) => client.call(getCancellation, { params: { id: tradeId } }, { signal }),
  });
}

/**
 * The trade's refunds, newest first (CR3, SC2). Polled while one is on its way back to the buyer, and only then:
 * once it is PROCESSED (or held for the team) the answer stops changing.
 */
export function useTradeRefunds(tradeId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: refundKeys.forTrade(tradeId),
    queryFn: ({ signal }) => client.call(listTradeRefunds, { params: { id: tradeId } }, { signal }),
    refetchInterval: (query) =>
      query.state.data?.refunds.some(isRefundInFlight) === true ? REFUND_POLL_MS : false,
  });
}

/** The signed-in person's refunds as a buyer. A stale cursor (422) resets the list to its first page. */
export function useMyRefunds() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useInfiniteQuery({
    queryKey: refundKeys.mine,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPageParam,
    queryFn: async ({ pageParam, signal }) => {
      try {
        return await client.call(
          listMyRefunds,
          { query: { limit: REFUND_PAGE, ...(pageParam === undefined ? {} : { cursor: pageParam }) } },
          { signal },
        );
      } catch (error) {
        if (pageParam !== undefined && error instanceof ProblemError && error.status === 422) {
          void queryClient.resetQueries({ queryKey: refundKeys.mine });
        }
        throw error;
      }
    },
  });
}

/**
 * Every cancellation answer changes the trade (or soon will: the refund closes it), so the trade, its
 * cancellation and its refunds are all read again, with the trade lists and the buyer's refund history.
 */
function useCancellationMutation<V extends { tradeId: string }>(
  call: (client: ReturnType<typeof useApiClient>, variables: V) => Promise<unknown>,
) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: V) => call(client, variables),
    onSettled: async (_answer, _error, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: tradeKeys.one(variables.tradeId) }),
        queryClient.invalidateQueries({ queryKey: ['trades', 'list'] }),
        queryClient.invalidateQueries({ queryKey: refundKeys.mine }),
      ]);
    },
  });
}

interface WithKey {
  /** Held by the screen for one decision and sent again by its "try again", so a retry is one answer. */
  idempotencyKey?: string;
}

const keyed = (variables: WithKey) =>
  variables.idempotencyKey === undefined ? {} : { idempotencyKey: variables.idempotencyKey };

/** CR1: the buyer asks the seller to cancel. */
export const useRequestCancellation = () =>
  useCancellationMutation(
    (client, v: { tradeId: string; reason: BuyerCancellationReason; note?: string } & WithKey) =>
      client.call(
        requestCancellation,
        { params: { id: v.tradeId }, body: { reason: v.reason, ...(v.note ? { note: v.note } : {}) } },
        keyed(v),
      ),
  );

/** CR2: the seller agrees; the buyer is refunded in full. */
export const useApproveCancellation = () =>
  useCancellationMutation((client, v: { tradeId: string; requestId: string; note?: string } & WithKey) =>
    client.call(
      approveCancellation,
      { params: { id: v.tradeId, requestId: v.requestId }, body: v.note ? { note: v.note } : {} },
      keyed(v),
    ),
  );

/** CR2: the seller declines. */
export const useDeclineCancellation = () =>
  useCancellationMutation((client, v: { tradeId: string; requestId: string; note?: string } & WithKey) =>
    client.call(
      declineCancellation,
      { params: { id: v.tradeId, requestId: v.requestId }, body: v.note ? { note: v.note } : {} },
      keyed(v),
    ),
  );

/** SC1: the seller cannot fulfil; the buyer is refunded in full (SC2). */
export const useCancelAsSeller = () =>
  useCancellationMutation(
    (client, v: { tradeId: string; reason: SellerCancellationReason; note?: string } & WithKey) =>
      client.call(
        cancelAsSeller,
        { params: { id: v.tradeId }, body: { reason: v.reason, ...(v.note ? { note: v.note } : {}) } },
        keyed(v),
      ),
  );
