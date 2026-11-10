'use client';

// The queries and mutations behind the identity review screens. Lists are numbered-page infinite
// queries (the backend pages these by page number and total), refetched on focus and once a minute.
// A mutation, won or lost, marks the queue, the flags, the item and the universal case stale: the
// person who took an item must see it leave "Needs a person".
import {
  approveApproval,
  assignKycItem,
  decideKycItem,
  getKycItem,
  listDuplicateFlags,
  listKycQueue,
  requestVerificationOverride,
  resolveDuplicateFlag,
  type DuplicateFlag,
  type DuplicateFlagStatus,
  type KycQueueItem,
} from '@komtru/api-client';
import { useApiClient } from '@komtru/app-kit/react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { casesKeys, REFRESH_MS } from '../cases/hooks';

const PAGE = 50;

export const kycKeys = {
  all: ['kyc'] as const,
  queue: (type: 'IDENTITY' | 'KYB' | undefined) => ['kyc', 'queue', type ?? 'all'] as const,
  flags: (status: DuplicateFlagStatus | undefined) => ['kyc', 'flags', status ?? 'all'] as const,
  item: (requestId: string) => ['kyc', 'item', requestId] as const,
};

export interface PagedResult<T> {
  rows: T[];
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  loading: boolean;
  failed: boolean;
  retry: () => void;
}

interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

/** The next page number while the pages loaded so far hold fewer rows than the total. */
const nextPage = <T>(last: Page<T>): number | undefined =>
  last.page * last.limit < last.total ? last.page + 1 : undefined;

function shape<T>(query: {
  data: { pages: Page<T>[] } | undefined;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
  isFetchingNextPage: boolean;
  isPending: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}): PagedResult<T> {
  return {
    rows: query.data?.pages.flatMap((page) => page.items) ?? [],
    hasMore: query.hasNextPage,
    loadMore: () => void query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
    loading: query.isPending,
    failed: query.isError && query.data === undefined,
    retry: () => void query.refetch(),
  };
}

export function useKycQueue(
  type: 'IDENTITY' | 'KYB' | undefined,
  enabled: boolean,
): PagedResult<KycQueueItem> {
  const client = useApiClient();
  const query = useInfiniteQuery({
    queryKey: kycKeys.queue(type),
    initialPageParam: 1,
    enabled,
    queryFn: ({ pageParam, signal }) =>
      client.call(
        listKycQueue,
        { query: { show: 'open', ...(type === undefined ? {} : { type }), page: pageParam, limit: PAGE } },
        { signal },
      ),
    getNextPageParam: nextPage,
    refetchInterval: REFRESH_MS,
  });
  return shape(query);
}

export function useDuplicateFlags(enabled: boolean): PagedResult<DuplicateFlag> {
  const client = useApiClient();
  const query = useInfiniteQuery({
    queryKey: kycKeys.flags(undefined),
    initialPageParam: 1,
    enabled,
    queryFn: ({ pageParam, signal }) =>
      client.call(listDuplicateFlags, { query: { page: pageParam, limit: PAGE } }, { signal }),
    getNextPageParam: nextPage,
    refetchInterval: REFRESH_MS,
  });
  return shape(query);
}

export function useKycItem(requestId: string, enabled: boolean) {
  const client = useApiClient();
  return useQuery({
    queryKey: kycKeys.item(requestId),
    enabled,
    queryFn: ({ signal }) => client.call(getKycItem, { params: { requestId } }, { signal }),
    retry: false,
  });
}

/** A staff action in the identity area. After any attempt the lists, the item and the case are stale. */
export function useKycAction<Vars, Output>(
  run: (client: ReturnType<typeof useApiClient>, vars: Vars) => Promise<Output>,
) {
  const client = useApiClient();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (vars: Vars) => run(client, vars),
    onSettled: () =>
      Promise.all([
        queries.invalidateQueries({ queryKey: kycKeys.all }),
        queries.invalidateQueries({ queryKey: casesKeys.all }),
      ]),
  });
}

export const kycCalls = {
  assign: (client: ReturnType<typeof useApiClient>, requestId: string) =>
    client.call(assignKycItem, { params: { requestId }, body: {} }),
  decide: (
    client: ReturnType<typeof useApiClient>,
    vars: { requestId: string; outcome: 'APPROVE' | 'REJECT'; reason: string; policyCitation?: string },
  ) =>
    client.call(decideKycItem, {
      params: { requestId: vars.requestId },
      body: {
        outcome: vars.outcome,
        reason: vars.reason,
        ...(vars.policyCitation === undefined ? {} : { policyCitation: vars.policyCitation }),
      },
    }),
  resolve: (
    client: ReturnType<typeof useApiClient>,
    vars: {
      flagId: string;
      resolution: 'CONFIRMED_DUPLICATE' | 'CLEARED_FALSE_POSITIVE' | 'ESCALATED';
      reason: string;
      approvalId?: string;
    },
  ) =>
    client.call(resolveDuplicateFlag, {
      params: { id: vars.flagId },
      body: {
        resolution: vars.resolution,
        reason: vars.reason,
        ...(vars.approvalId === undefined ? {} : { approvalId: vars.approvalId }),
      },
    }),
  askClearance: (client: ReturnType<typeof useApiClient>, vars: { flagId: string; reason: string }) =>
    client.call(requestVerificationOverride, {
      body: { kind: 'CLEAR_DUPLICATE', flagId: vars.flagId, reason: vars.reason },
    }),
  approve: (client: ReturnType<typeof useApiClient>, vars: { approvalId: string; reason: string }) =>
    client.call(approveApproval, { params: { approvalId: vars.approvalId }, body: { reason: vars.reason } }),
};
