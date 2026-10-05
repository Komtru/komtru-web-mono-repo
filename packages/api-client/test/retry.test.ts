import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkError, ProblemError, readResponseMeta, TimeoutError } from '../src/problems.js';
import { DEFAULT_RETRY_POLICY, isRetryable, retryDelayMs, sleep } from '../src/retry.js';

const problem = (status: number, code: string, headers: Record<string, string> = {}) =>
  new ProblemError(
    { type: 'about:blank', title: code, status, code },
    readResponseMeta(new Headers(headers), status),
    false,
  );

afterEach(() => {
  vi.useRealTimers();
});

describe('isRetryable', () => {
  it('retries what a repeat can fix, for an idempotent call', () => {
    expect(isRetryable(new NetworkError('offline'), true)).toBe(true);
    expect(isRetryable(new TimeoutError('slow'), true)).toBe(true);
    expect(isRetryable(problem(408, 'INTERNAL'), true)).toBe(true);
    expect(isRetryable(problem(429, 'RATE_LIMITED'), true)).toBe(true);
    expect(isRetryable(problem(500, 'INTERNAL'), true)).toBe(true);
    expect(isRetryable(problem(503, 'INTERNAL'), true)).toBe(true);
  });

  it('never retries a mutating call that carries no key: it may already have landed', () => {
    expect(isRetryable(new NetworkError('offline'), false)).toBe(false);
    expect(isRetryable(new TimeoutError('slow'), false)).toBe(false);
    expect(isRetryable(problem(503, 'INTERNAL'), false)).toBe(false);
  });

  it('retries a 409 only when the call is idempotent', () => {
    // The backend's own words: "A request with this idempotency key is still in progress. Retry in
    // a moment to get its result."
    expect(isRetryable(problem(409, 'CONFLICT'), true)).toBe(true);
    expect(isRetryable(problem(409, 'CONFLICT'), false)).toBe(false);
  });

  it('never retries a reused idempotency key, however idempotent the call claims to be', () => {
    expect(isRetryable(problem(422, 'IDEMPOTENCY_KEY_REUSED'), true)).toBe(false);
  });

  it('never retries the client’s own mistakes', () => {
    expect(isRetryable(problem(400, 'VALIDATION_FAILED'), true)).toBe(false);
    expect(isRetryable(problem(401, 'UNAUTHENTICATED'), true)).toBe(false);
    expect(isRetryable(problem(403, 'FORBIDDEN'), true)).toBe(false);
    expect(isRetryable(problem(404, 'NOT_FOUND'), true)).toBe(false);
    expect(isRetryable(problem(422, 'VALIDATION_FAILED'), true)).toBe(false);
  });

  it('never retries something that is not an api-client error', () => {
    expect(isRetryable(new TypeError('bad input'), true)).toBe(false);
  });
});

describe('retryDelayMs', () => {
  const policy = { ...DEFAULT_RETRY_POLICY, random: () => 1 };

  it('obeys the server’s Retry-After over its own backoff', () => {
    expect(retryDelayMs(0, problem(429, 'RATE_LIMITED', { 'Retry-After': '30' }), policy)).toBe(30_000);
  });

  it('backs off exponentially with full jitter', () => {
    expect(retryDelayMs(0, new NetworkError('x'), policy)).toBe(300);
    expect(retryDelayMs(1, new NetworkError('x'), policy)).toBe(600);
    expect(retryDelayMs(2, new NetworkError('x'), policy)).toBe(1_200);
  });

  it('jitters down to nothing, so a fleet does not retry in lockstep', () => {
    expect(retryDelayMs(3, new NetworkError('x'), { ...policy, random: () => 0 })).toBe(0);
    expect(retryDelayMs(3, new NetworkError('x'), { ...policy, random: () => 0.5 })).toBe(1_200);
  });

  it('caps the backoff', () => {
    expect(retryDelayMs(20, new NetworkError('x'), policy)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
  });
});

describe('sleep', () => {
  it('resolves after the delay', async () => {
    vi.useFakeTimers();
    const resolved = vi.fn();
    const pending = sleep(1_000).then(resolved);
    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(resolved).toHaveBeenCalled();
  });

  it('rejects when the caller aborts mid-wait', async () => {
    const controller = new AbortController();
    const pending = sleep(10_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(NetworkError);
  });

  it('rejects immediately for a signal that is already aborted', async () => {
    await expect(sleep(10_000, AbortSignal.abort())).rejects.toBeInstanceOf(NetworkError);
  });
});
