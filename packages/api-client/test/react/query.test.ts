import type { Paginated } from '@komtru/shared-types';
import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { IDEMPOTENCY_KEY_PATTERN } from '../../src/idempotency.js';
import { ProblemError, readResponseMeta } from '../../src/problems.js';
import {
  cursorInfiniteQueryOptions,
  optimisticMutationOptions,
  retryProblemAware,
} from '../../src/react/query.js';

const page = (ids: string[], nextCursor: string | null): Paginated<{ id: string }> => ({
  items: ids.map((id) => ({ id })),
  nextCursor,
});

const problem = (status: number, code: string) =>
  new ProblemError(
    { type: 'about:blank', title: code, status, code },
    readResponseMeta(new Headers(), status),
    false,
  );

describe('cursorInfiniteQueryOptions', () => {
  it('starts with no cursor and stops when nextCursor is null', () => {
    const options = cursorInfiniteQueryOptions({
      queryKey: ['trades'],
      fetchPage: () => Promise.resolve(page([], null)),
    });
    expect(options.initialPageParam).toBeUndefined();
    expect(options.getNextPageParam(page(['a'], 'c1'))).toBe('c1');
    expect(options.getNextPageParam(page(['a'], null))).toBeUndefined();
  });

  it('passes the page param on as the cursor, with the query signal', async () => {
    const fetchPage = vi.fn(() => Promise.resolve(page(['a'], null)));
    const options = cursorInfiniteQueryOptions({ queryKey: ['trades'], fetchPage });
    const signal = new AbortController().signal;

    await options.queryFn({ pageParam: 'c1', signal });

    expect(fetchPage).toHaveBeenCalledWith('c1', signal);
  });
});

describe('optimisticMutationOptions', () => {
  const setup = () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['trades'], { items: [{ id: 'a' }], nextCursor: null });
    return queryClient;
  };

  it('applies the change straight away and hands the mutation an idempotency key', async () => {
    const queryClient = setup();
    const mutationFn = vi.fn(() => Promise.resolve({ ok: true }));
    const options = optimisticMutationOptions<{ id: string }, { ok: boolean }, Paginated<{ id: string }>>({
      queryClient,
      queryKey: ['trades'],
      mutationFn,
      apply: (previous, variables) =>
        previous && { ...previous, items: [...previous.items, { id: variables.id }] },
    });

    await options.onMutate({ id: 'b' });

    expect(queryClient.getQueryData(['trades'])).toEqual({
      items: [{ id: 'a' }, { id: 'b' }],
      nextCursor: null,
    });

    await options.mutationFn({ id: 'b' }, {});
    expect(mutationFn).toHaveBeenCalledWith({ id: 'b' }, expect.stringMatching(IDEMPOTENCY_KEY_PATTERN));
  });

  /** Drives TanStack's own retry machinery rather than calling the option functions by hand. */
  const trackingOptions = (queryClient: QueryClient, keys: string[], onAttempt?: () => void) =>
    optimisticMutationOptions<{ id: string }, void, Paginated<{ id: string }>>({
      queryClient,
      queryKey: ['trades'],
      mutationFn: (_variables, key) => {
        keys.push(key);
        onAttempt?.();
        return keys.length === 1 ? Promise.reject(new Error('flaky')) : Promise.resolve();
      },
      apply: (previous) => previous,
    });

  it('sends one key across a retry that TanStack itself drives', async () => {
    const queryClient = setup();
    const keys: string[] = [];
    const observer = new MutationObserver(queryClient, {
      ...trackingOptions(queryClient, keys),
      retry: 1,
      retryDelay: 0,
    });

    await observer.mutate({ id: 'b' });

    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(IDEMPOTENCY_KEY_PATTERN);
  });

  it('keeps the key when a re-render replaces the pending mutation’s options', async () => {
    // TanStack re-reads options.mutationFn on every attempt, and a re-render while the mutation is
    // pending swaps the whole options object. A key held in the factory closure would change here.
    const queryClient = setup();
    const keys: string[] = [];
    const observer = new MutationObserver(queryClient, {
      ...trackingOptions(queryClient, keys, () => {
        if (keys.length === 1) {
          observer.setOptions({ ...trackingOptions(queryClient, keys), retry: 1, retryDelay: 0 });
        }
      }),
      retry: 1,
      retryDelay: 0,
    });

    await observer.mutate({ id: 'b' });

    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  it('gives two mutations in flight at once their own keys', async () => {
    const queryClient = setup();
    const options = optimisticMutationOptions<{ id: string }, void, Paginated<{ id: string }>>({
      queryClient,
      queryKey: ['trades'],
      mutationFn: (_variables, key) => Promise.resolve(key) as unknown as Promise<void>,
      apply: (previous) => previous,
    });

    // The same variables object on purpose: two taps of the same button are two actions.
    const variables = { id: 'b' };
    const first = (await options.mutationFn(variables, {})) as unknown as string;
    const second = (await options.mutationFn(variables, {})) as unknown as string;

    expect(first).not.toBe(second);
  });

  it('rolls the cache back when the mutation fails', async () => {
    const queryClient = setup();
    const options = optimisticMutationOptions<{ id: string }, void, Paginated<{ id: string }>>({
      queryClient,
      queryKey: ['trades'],
      mutationFn: () => Promise.resolve(),
      apply: (previous, variables) =>
        previous && { ...previous, items: [...previous.items, { id: variables.id }] },
    });

    const context = await options.onMutate({ id: 'b' });
    options.onError(problem(409, 'INVALID_TRANSITION'), { id: 'b' }, context);

    expect(queryClient.getQueryData(['trades'])).toEqual({ items: [{ id: 'a' }], nextCursor: null });
  });

  it('refetches from the server once the dust has settled', async () => {
    const queryClient = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const options = optimisticMutationOptions<{ id: string }, void, Paginated<{ id: string }>>({
      queryClient,
      queryKey: ['trades'],
      mutationFn: () => Promise.resolve(),
      apply: (previous) => previous,
    });

    await options.onSettled();

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['trades'] });
  });
});

describe('retryProblemAware', () => {
  it('retries what a repeat can fix, up to the cap', () => {
    const retry = retryProblemAware({ idempotent: true, maxAttempts: 3 });
    expect(retry(0, problem(503, 'INTERNAL'))).toBe(true);
    expect(retry(1, problem(503, 'INTERNAL'))).toBe(true);
    expect(retry(2, problem(503, 'INTERNAL'))).toBe(false);
  });

  it('never retries a problem a repeat cannot fix', () => {
    const retry = retryProblemAware({ idempotent: true });
    expect(retry(0, problem(403, 'FORBIDDEN'))).toBe(false);
    expect(retry(0, problem(422, 'IDEMPOTENCY_KEY_REUSED'))).toBe(false);
  });

  it('never retries a mutation with no idempotency key', () => {
    expect(retryProblemAware({ idempotent: false })(0, problem(503, 'INTERNAL'))).toBe(false);
  });
});
