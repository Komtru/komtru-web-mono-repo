'use client';

// The queries and mutations behind the merchant application screens. The queue is a numbered-page
// infinite query (the backend pages it by page number and total), refetched on focus and once a minute;
// the count behind the sidebar item is refetched on the same clock. A decision, won or lost, marks the
// queue, the count, the application and the universal case stale, so the person who decided sees the
// application leave "Awaiting review" at once and everyone else's rail catches up within the minute.
import {
  approveMerchantApplication,
  assignMerchantApplication,
  countMerchantApplications,
  getMerchantApplication,
  getMerchantDocument,
  listMerchantApplications,
  listTradeStandards,
  rejectMerchantApplication,
  requestMerchantChanges,
  type MerchantApplicationStatus,
  type MerchantChangeItem,
  type MerchantDocumentType,
  type MerchantQueueItem,
} from '@komtru/api-client';
import { useApiClient } from '@komtru/app-kit/react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { casesKeys, REFRESH_MS } from '../cases/hooks';
import type { PagedResult } from '../identity/hooks';

const PAGE = 50;

export const merchantKeys = {
  all: ['merchant'] as const,
  count: ['merchant', 'count'] as const,
  queue: (status: MerchantApplicationStatus | undefined, category: string | undefined) =>
    ['merchant', 'queue', status ?? 'open', category ?? 'all'] as const,
  item: (id: string) => ['merchant', 'item', id] as const,
  categories: ['merchant', 'categories'] as const,
};

interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

const nextPage = <T>(last: Page<T>): number | undefined =>
  last.page * last.limit < last.total ? last.page + 1 : undefined;

export function useMerchantQueue(
  status: MerchantApplicationStatus | undefined,
  category: string | undefined,
  enabled: boolean,
): PagedResult<MerchantQueueItem> {
  const client = useApiClient();
  const query = useInfiniteQuery({
    queryKey: merchantKeys.queue(status, category),
    initialPageParam: 1,
    enabled,
    queryFn: ({ pageParam, signal }) =>
      client.call(
        listMerchantApplications,
        {
          query: {
            // A named status shows exactly that; with none the queue is what awaits a person.
            ...(status === undefined ? { show: 'open' as const } : { status, show: 'all' as const }),
            ...(category === undefined ? {} : { category }),
            page: pageParam,
            limit: PAGE,
          },
        },
        { signal },
      ),
    getNextPageParam: nextPage,
    refetchInterval: REFRESH_MS,
  });
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

/** The sidebar's number. Anything but a number is no number: the item is then drawn without one. */
export function useMerchantAwaiting(enabled: boolean): number | undefined {
  const client = useApiClient();
  const query = useQuery({
    queryKey: merchantKeys.count,
    enabled,
    queryFn: ({ signal }) => client.call(countMerchantApplications, {}, { signal }),
    refetchInterval: REFRESH_MS,
    retry: false,
  });
  const value: unknown = (query.data as { awaitingReview?: unknown } | undefined)?.awaitingReview;
  return typeof value === 'number' ? value : undefined;
}

export function useMerchantApplication(id: string, enabled: boolean) {
  const client = useApiClient();
  return useQuery({
    queryKey: merchantKeys.item(id),
    enabled,
    queryFn: ({ signal }) => client.call(getMerchantApplication, { params: { id } }, { signal }),
    retry: false,
    // No refetch on a timer: the application carries no signed links, so there is nothing to keep fresh,
    // and a page left open must not write to anyone's access log.
  });
}

/**
 * One document, signed when `enabled` turns true (a reviewer pressed View) and not before. Every call is
 * a row in `file_access_log`, so it never refetches on a timer or on window focus: the link stays the
 * one that was issued, and a PDF being read does not jump back to page one.
 */
export function useMerchantDocument(id: string, docType: MerchantDocumentType, enabled: boolean) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['merchant', 'document', id, docType] as const,
    enabled,
    queryFn: ({ signal }) => client.call(getMerchantDocument, { params: { id, docType } }, { signal }),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    // A short life in the cache: a link reopened ten minutes later is a new, logged view.
    gcTime: 60_000,
    staleTime: Infinity,
  });
}

/** The categories a merchant may sell in, for the queue's filter: the platform's own list of standards. */
export function useMerchantCategories(enabled: boolean) {
  const client = useApiClient();
  return useQuery({
    queryKey: merchantKeys.categories,
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async ({ signal }) => {
      const page = await client.call(listTradeStandards, { query: { limit: 100 } }, { signal });
      return page.items.map((standard) => ({ code: standard.categoryCode, name: standard.categoryName }));
    },
  });
}

export function useMerchantAction<Vars, Output>(
  run: (client: ReturnType<typeof useApiClient>, vars: Vars) => Promise<Output>,
) {
  const client = useApiClient();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (vars: Vars) => run(client, vars),
    onSettled: () =>
      Promise.all([
        queries.invalidateQueries({ queryKey: merchantKeys.all }),
        queries.invalidateQueries({ queryKey: casesKeys.all }),
      ]),
  });
}

interface Decision {
  id: string;
  reason: string;
  policyCitation: string;
}

export const merchantCalls = {
  assign: (client: ReturnType<typeof useApiClient>, id: string) =>
    client.call(assignMerchantApplication, { params: { id }, body: {} }),
  approve: (client: ReturnType<typeof useApiClient>, vars: Decision) =>
    client.call(approveMerchantApplication, {
      params: { id: vars.id },
      body: { reason: vars.reason, policyCitation: vars.policyCitation },
    }),
  reject: (client: ReturnType<typeof useApiClient>, vars: Decision) =>
    client.call(rejectMerchantApplication, {
      params: { id: vars.id },
      body: { reason: vars.reason, policyCitation: vars.policyCitation },
    }),
  requestChanges: (
    client: ReturnType<typeof useApiClient>,
    vars: Decision & { requested: MerchantChangeItem[] },
  ) =>
    client.call(requestMerchantChanges, {
      params: { id: vars.id },
      body: { reason: vars.reason, policyCitation: vars.policyCitation, requested: vars.requested },
    }),
};
