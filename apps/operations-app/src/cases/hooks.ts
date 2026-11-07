'use client';

// The queries and mutations behind the work-queue screens. Every list is a cursor-paginated infinite
// query, refetched on window focus and once a minute: the console has no case socket events yet.
import {
  caseQueueCounts,
  getCase,
  getCaseAdvisory,
  listCaseQueue,
  listCaseTrail,
  listCases,
  nextPageParam,
  type CaseQueueView,
  type CaseType,
  type CasePriority,
  type CaseState,
  type CaseView,
} from '@komtru/api-client';
import { useApiClient } from '@komtru/app-kit/react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const REFRESH_MS = 60_000;
const PAGE = 50;

export interface CaseFilters {
  type?: CaseType | undefined;
  state?: CaseState | undefined;
  priority?: CasePriority | undefined;
  subjectType?: string | undefined;
  subjectId?: string | undefined;
  q?: string | undefined;
}

/** Drops the keys a person has not set, so the query string carries only real filters. */
const clean = <T extends object>(filters: T): T =>
  Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== '')) as T;

export const casesKeys = {
  all: ['cases'] as const,
  counts: ['cases', 'counts'] as const,
  queue: (view: CaseQueueView, filters: CaseFilters) => ['cases', 'queue', view, clean(filters)] as const,
  list: (filters: CaseFilters) => ['cases', 'list', clean(filters)] as const,
  detail: (id: string) => ['cases', 'detail', id] as const,
  trail: (id: string) => ['cases', 'trail', id] as const,
  advisory: (id: string) => ['cases', 'advisory', id] as const,
};

export interface CaseListResult {
  cases: CaseView[];
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  loading: boolean;
  failed: boolean;
  retry: () => void;
}

function shape(query: {
  data: { pages: { items: CaseView[] }[] } | undefined;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
  isFetchingNextPage: boolean;
  isPending: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}): CaseListResult {
  return {
    cases: query.data?.pages.flatMap((page) => page.items) ?? [],
    hasMore: query.hasNextPage,
    loadMore: () => void query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
    loading: query.isPending,
    failed: query.isError && query.data === undefined,
    retry: () => void query.refetch(),
  };
}

export function useCaseQueue(view: CaseQueueView, filters: CaseFilters = {}): CaseListResult {
  const client = useApiClient();
  const query = useInfiniteQuery({
    queryKey: casesKeys.queue(view, filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.call(
        listCaseQueue,
        { query: { view, ...clean(filters), limit: PAGE, ...(pageParam ? { cursor: pageParam } : {}) } },
        { signal },
      ),
    getNextPageParam: nextPageParam,
    refetchInterval: REFRESH_MS,
  });
  return shape(query);
}

export function useCaseList(
  filters: CaseFilters = {},
  options: { enabled?: boolean; owner?: string } = {},
): CaseListResult {
  const client = useApiClient();
  const query = useInfiniteQuery({
    queryKey: [...casesKeys.list(filters), options.owner ?? null],
    initialPageParam: undefined as string | undefined,
    enabled: options.enabled ?? true,
    queryFn: ({ pageParam, signal }) =>
      client.call(
        listCases,
        {
          query: {
            ...clean(filters),
            ...(options.owner === undefined ? {} : { owner: options.owner }),
            limit: PAGE,
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
        { signal },
      ),
    getNextPageParam: nextPageParam,
    refetchInterval: REFRESH_MS,
  });
  return shape(query);
}

export function useCaseCounts() {
  const client = useApiClient();
  return useQuery({
    queryKey: casesKeys.counts,
    queryFn: ({ signal }) => client.call(caseQueueCounts, {}, { signal }),
    refetchInterval: REFRESH_MS,
  });
}

export function useCaseDetail(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: casesKeys.detail(id),
    queryFn: ({ signal }) => client.call(getCase, { params: { id } }, { signal }),
  });
}

export function useCaseTrail(id: string) {
  const client = useApiClient();
  const query = useInfiniteQuery({
    queryKey: casesKeys.trail(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.call(
        listCaseTrail,
        { params: { id }, query: { limit: 50, ...(pageParam ? { cursor: pageParam } : {}) } },
        { signal },
      ),
    getNextPageParam: nextPageParam,
  });
  return {
    entries: query.data?.pages.flatMap((page) => page.items) ?? [],
    hasMore: query.hasNextPage,
    loadMore: () => void query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
    loading: query.isPending,
    failed: query.isError && query.data === undefined,
  };
}

/** The advisory is a read and stays a read: nothing here posts, and nothing takes it as an input. */
export function useCaseAdvisory(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: casesKeys.advisory(id),
    queryFn: ({ signal }) => client.call(getCaseAdvisory, { params: { id } }, { signal }),
    retry: false,
  });
}

/**
 * A staff action on a case. After any attempt, won or lost, the queue, counts, list and that case are stale, so
 * they are all refetched: the person who took a case must see it leave "Team queue".
 */
export function useCaseAction<Vars, Output>(
  run: (client: ReturnType<typeof useApiClient>, vars: Vars) => Promise<Output>,
) {
  const client = useApiClient();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (vars: Vars) => run(client, vars),
    onSettled: () => queries.invalidateQueries({ queryKey: casesKeys.all }),
  });
}
