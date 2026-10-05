import type { Paginated } from '@komtru/shared-types';
import { QueryClient } from '@tanstack/react-query';
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

  it('applies the change straight away and gives the mutation one idempotency key', async () => {
    const queryClient = setup();
    const mutationFn = vi.fn(() => Promise.resolve({ ok: true }));
    const options = optimisticMutationOptions<{ id: string }, { ok: boolean }, Paginated<{ id: string }>>({
      queryClient,
      queryKey: ['trades'],
      mutationFn,
      apply: (previous, variables) =>
        previous && { ...previous, items: [...previous.items, { id: variables.id }] },
    });

    const context = await options.onMutate({ id: 'b' });

    expect(queryClient.getQueryData(['trades'])).toEqual({
      items: [{ id: 'a' }, { id: 'b' }],
      nextCursor: null,
    });
    expect(context.idempotencyKey).toMatch(IDEMPOTENCY_KEY_PATTERN);

    await options.mutationFn({ id: 'b' });
    expect(mutationFn).toHaveBeenCalledWith({ id: 'b' }, expect.stringMatching(IDEMPOTENCY_KEY_PATTERN));
  });

  it('keeps one key across a retry of the same mutation', async () => {
    const queryClient = setup();
    const keys: string[] = [];
    const options = optimisticMutationOptions<{ id: string }, void, Paginated<{ id: string }>>({
      queryClient,
      queryKey: ['trades'],
      mutationFn: (_variables, key) => {
        keys.push(key);
        return Promise.resolve();
      },
      apply: (previous) => previous,
    });

    await options.onMutate({ id: 'b' });
    await options.mutationFn({ id: 'b' });
    await options.mutationFn({ id: 'b' });

    expect(new Set(keys).size).toBe(1);
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
