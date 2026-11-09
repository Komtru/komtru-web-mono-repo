'use client';

// The proposal screens' queries and mutations (T-061). Every mutation answers with the trade as it now
// stands, so it is written into the cache under the trade's own key: the screen that sent the answer
// and the one it navigates to read the same copy, with no refetch in between.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from '../client.js';
import type { EndpointInput } from '../contracts.js';
import {
  acceptTrade,
  cancelTrade,
  claimTrade,
  counterTrade,
  createTrade,
  declineTrade,
  getDeliveryDeadline,
  getInspection,
  getTrade,
  listTradeActivity,
  listTrades,
  previewTrade,
  sendTrade,
  type TradeView,
} from '../trades.js';
import { ProblemError } from '../problems.js';
import { nextPageParam } from '../pagination.js';
import type { TradeListState } from '@komtru/shared-types';
import { getTradeStandardVersion, listTradeStandards, type TradeStandard } from '../standards.js';
import { useApiClient } from './client-context.js';

export const tradeKeys = {
  all: ['trades'] as const,
  one: (id: string) => ['trades', id] as const,
  standards: ['trade-standards'] as const,
  list: (state: TradeListState) => ['trades', 'list', state] as const,
  /** Everything read about one trade sits under `one(id)`, so one invalidation refetches all of it. */
  activity: (id: string) => ['trades', id, 'activity'] as const,
  deliveryDeadline: (id: string) => ['trades', id, 'delivery-deadline'] as const,
  inspection: (id: string) => ['trades', id, 'inspection'] as const,
};

export const tradeQueryOptions = (client: ApiClient, id: string) => ({
  queryKey: tradeKeys.one(id),
  queryFn: ({ signal }: { signal: AbortSignal }): Promise<TradeView> =>
    client.call(getTrade, { params: { id } }, { signal }),
});

/** One trade, as the signed-in person sees it. */
export function useTrade(id: string) {
  const client = useApiClient();
  return useQuery(tradeQueryOptions(client, id));
}

/** Every category's current standard. A handful of rows, so one page holds them all. */
export async function fetchAllTradeStandards(
  client: ApiClient,
  signal?: AbortSignal,
): Promise<TradeStandard[]> {
  const options = signal ? { signal } : {};
  const first = await client.call(listTradeStandards, { query: { page: 1, limit: 100 } }, options);
  return first.items;
}

export function useTradeStandards() {
  const client = useApiClient();
  return useQuery({
    queryKey: tradeKeys.standards,
    queryFn: ({ signal }) => fetchAllTradeStandards(client, signal),
    staleTime: 5 * 60 * 1000,
  });
}

export const usePreviewTrade = () => {
  const client = useApiClient();
  return useMutation({
    mutationFn: (body: EndpointInput<typeof previewTrade>['body']) => client.call(previewTrade, { body }),
  });
};

function useTradeMutation<TVariables>(
  call: (client: ApiClient, variables: TVariables) => Promise<TradeView>,
) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: TVariables) => call(client, variables),
    onSuccess: (trade) => {
      queryClient.setQueryData(tradeKeys.one(trade.id), trade);
      // The trade moved, so every cached list of trades is out of date.
      void queryClient.invalidateQueries({ queryKey: ['trades', 'list'] });
    },
  });
}

export const useCreateTrade = () =>
  useTradeMutation((client, body: EndpointInput<typeof createTrade>['body']) =>
    client.call(createTrade, { body }),
  );

export const useSendTrade = () =>
  useTradeMutation((client, { id, ...body }: { id: string } & EndpointInput<typeof sendTrade>['body']) =>
    client.call(sendTrade, { params: { id }, body }),
  );

export const useCounterTrade = () =>
  useTradeMutation((client, { id, ...body }: { id: string } & EndpointInput<typeof counterTrade>['body']) =>
    client.call(counterTrade, { params: { id }, body }),
  );

export const useAcceptTrade = () =>
  useTradeMutation((client, { id, ...body }: { id: string } & EndpointInput<typeof acceptTrade>['body']) =>
    client.call(acceptTrade, { params: { id }, body }),
  );

export const useDeclineTrade = () =>
  useTradeMutation((client, { id, reason }: { id: string; reason: string }) =>
    client.call(declineTrade, { params: { id }, body: { reason } }),
  );

export const useCancelTrade = () =>
  useTradeMutation((client, { id, reason }: { id: string; reason?: string }) =>
    client.call(cancelTrade, { params: { id }, body: reason === undefined ? {} : { reason } }),
  );

export const useClaimTrade = () =>
  useTradeMutation((client, id: string) => client.call(claimTrade, { params: { id } }));

const LIST_PAGE = 20;

/**
 * The caller's trades, a page at a time. The cursor goes back to the server exactly as it came. A 422 on
 * a cursor means it no longer fits the filter, so the list is reset to page one once; the same cursor is
 * never sent twice.
 */
export function useTradeList(state: TradeListState = 'ALL') {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useInfiniteQuery({
    queryKey: tradeKeys.list(state),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPageParam,
    queryFn: async ({ pageParam, signal }) => {
      try {
        return await client.call(
          listTrades,
          { query: { state, limit: LIST_PAGE, ...(pageParam === undefined ? {} : { cursor: pageParam }) } },
          { signal },
        );
      } catch (error) {
        if (pageParam !== undefined && error instanceof ProblemError && error.status === 422) {
          void queryClient.resetQueries({ queryKey: tradeKeys.list(state) });
        }
        throw error;
      }
    },
  });
}

/**
 * The standard a trade froze, by the id on the trade. Idle for a trade with no standard. A version
 * never changes, so it is cached for good; a failure to read it is a real error for the screen to show,
 * never a reason to lower what the trade asks for.
 */
export function usePinnedStandard(versionId: string | null | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['trade-standard-version', versionId ?? ''] as const,
    queryFn: ({ signal }) =>
      client.call(getTradeStandardVersion, { params: { id: versionId ?? '' } }, { signal }),
    enabled: versionId !== null && versionId !== undefined,
    staleTime: Infinity,
  });
}

const ACTIVITY_PAGE = 20;

/**
 * A trade's history, newest first, a page at a time. Like the list, the cursor goes back exactly as it came,
 * and a 422 on one resets the feed to its first page once instead of resending it.
 */
export function useTradeActivity(id: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useInfiniteQuery({
    queryKey: tradeKeys.activity(id),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPageParam,
    queryFn: async ({ pageParam, signal }) => {
      try {
        return await client.call(
          listTradeActivity,
          {
            params: { id },
            query: { limit: ACTIVITY_PAGE, ...(pageParam === undefined ? {} : { cursor: pageParam }) },
          },
          { signal },
        );
      } catch (error) {
        if (pageParam !== undefined && error instanceof ProblemError && error.status === 422) {
          void queryClient.resetQueries({ queryKey: tradeKeys.activity(id) });
        }
        throw error;
      }
    },
  });
}

/** The delivery deadline, once the trade is funded and until it is delivered. Idle otherwise. */
export function useDeliveryDeadline(id: string, enabled: boolean) {
  const client = useApiClient();
  return useQuery({
    queryKey: tradeKeys.deliveryDeadline(id),
    queryFn: ({ signal }) => client.call(getDeliveryDeadline, { params: { id } }, { signal }),
    enabled,
  });
}

/** The inspection window and the delivery evidence. Idle until the trade is somewhere it applies. */
export function useInspection(id: string, enabled: boolean) {
  const client = useApiClient();
  return useQuery({
    queryKey: tradeKeys.inspection(id),
    queryFn: ({ signal }) => client.call(getInspection, { params: { id } }, { signal }),
    enabled,
  });
}
