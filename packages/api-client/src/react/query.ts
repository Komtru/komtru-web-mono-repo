'use client';

// TanStack Query option factories. Plain functions returning plain objects, which is why they are
// tested without rendering anything: the hooks that consume them are the app's business.
import type { Paginated } from '@komtru/shared-types';
import type { QueryClient } from '@tanstack/react-query';
import { createIdempotencyKey } from '../idempotency.js';
import { nextPageParam } from '../pagination.js';
import { isRetryable } from '../retry.js';

export interface CursorInfiniteQueryOptions<T> {
  queryKey: readonly unknown[];
  fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<Paginated<T>>;
}

/**
 * Cursor pagination, the platform default. `initialPageParam` is `undefined` because the first page
 * carries no cursor, and `getNextPageParam` maps the wire's `null` to TanStack's `undefined`, which
 * is what tells it there is no next page.
 */
export const cursorInfiniteQueryOptions = <T>({ queryKey, fetchPage }: CursorInfiniteQueryOptions<T>) => ({
  queryKey,
  queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
    fetchPage(pageParam, signal),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: nextPageParam<T>,
});

export interface OptimisticMutationContext<TSnapshot> {
  previous: TSnapshot | undefined;
}

/**
 * TanStack builds one context object per `mutate()` and hands the same one to every retry attempt,
 * while it re-reads `options.mutationFn` from the *current* options on each attempt — and replaces a
 * pending mutation's options outright when the component re-renders. So the key cannot live in this
 * factory's closure: by the time a retry runs, that closure belongs to a different render. Keying a
 * WeakMap on the per-mutation context object is the only identity that is stable across attempts and
 * distinct between two concurrent mutations, even when they share the same variables.
 */
const keysByMutation = new WeakMap<object, string>();

const keyFor = (context: object | undefined): string => {
  if (context === undefined) return createIdempotencyKey();
  const existing = keysByMutation.get(context);
  if (existing !== undefined) return existing;
  const minted = createIdempotencyKey();
  keysByMutation.set(context, minted);
  return minted;
};

export interface OptimisticMutationOptions<TVariables, TData, TSnapshot> {
  queryClient: QueryClient;
  queryKey: readonly unknown[];
  /** Receives the key for this user action; send it with the call so a retry is the same action. */
  mutationFn: (variables: TVariables, idempotencyKey: string) => Promise<TData>;
  /** Returns the cache value to show while the server is still thinking. */
  apply: (previous: TSnapshot | undefined, variables: TVariables) => TSnapshot | undefined;
}

/**
 * Apply, roll back, refetch — plus the piece that is easy to miss: the key is minted once per
 * `mutate()`, in `onMutate`, and reused by every TanStack retry of that same mutation. A key minted
 * inside `mutationFn` would be a new one per attempt, which is exactly what idempotency is for.
 */
export function optimisticMutationOptions<TVariables, TData, TSnapshot>({
  queryClient,
  queryKey,
  mutationFn,
  apply,
}: OptimisticMutationOptions<TVariables, TData, TSnapshot>) {
  return {
    mutationFn: (variables: TVariables, context?: object): Promise<TData> =>
      mutationFn(variables, keyFor(context)),

    onMutate: async (variables: TVariables): Promise<OptimisticMutationContext<TSnapshot>> => {
      // An in-flight refetch would otherwise land after the optimistic write and undo it.
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TSnapshot>(queryKey);
      queryClient.setQueryData(queryKey, apply(previous, variables));
      return { previous };
    },

    onError: (
      _error: unknown,
      _variables: TVariables,
      context: OptimisticMutationContext<TSnapshot> | undefined,
    ): void => {
      if (context) queryClient.setQueryData(queryKey, context.previous);
    },

    onSettled: async (): Promise<void> => {
      await queryClient.invalidateQueries({ queryKey });
    },
  };
}

export interface RetryProblemAwareOptions {
  /** True for a read, or for a mutation this client sends an Idempotency-Key with. */
  idempotent: boolean;
  maxAttempts?: number;
}

/** A `retry` for TanStack that knows which problem details a repeat can actually fix. */
export const retryProblemAware =
  ({ idempotent, maxAttempts = 3 }: RetryProblemAwareOptions) =>
  (failureCount: number, error: unknown): boolean =>
    failureCount + 1 < maxAttempts && isRetryable(error, idempotent);
