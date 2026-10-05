// What may be retried, and how long to wait. The rule that matters: a mutation is only retried when
// it carries an Idempotency-Key, because without one a timed-out POST may already have created a
// trade and sending it again would create a second.
import { NetworkError, ProblemError } from './problems.js';

export interface RetryPolicy {
  /** Including the first try: 3 means two retries. */
  maxAttempts: number;
  baseDelayMs: number;
  /** Bounds both the backoff and a `Retry-After` this client is willing to sit and wait out. */
  maxDelayMs: number;
  /** Injected so a test can pin the jitter. */
  random: () => number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 10_000,
  random: Math.random,
};

/**
 * `idempotent` is true for a GET or HEAD, and for a mutating call that carries an Idempotency-Key —
 * which this client only sends on a route the backend itself marked `retryable`.
 */
export function isRetryable(error: unknown, idempotent: boolean): boolean {
  if (!idempotent) return false;
  if (error instanceof NetworkError) return true;
  if (!(error instanceof ProblemError)) return false;

  // Sending the same key with the same body cannot produce this; the client built a different
  // request under a key it had already used, and repeating it will fail the same way.
  if (error.is('IDEMPOTENCY_KEY_REUSED')) return false;

  // 409 on an idempotent call is the idempotency gate saying a duplicate is still in flight.
  if (error.status === 409) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

/**
 * Exponential backoff with full jitter, unless the server said exactly how long to wait.
 *
 * `null` means "do not wait, give up": a rate limiter on a 15-minute window answers
 * `Retry-After: 900`, and silently holding the promise for a quarter of an hour is worse for the
 * person tapping Sign in than surfacing the 429, which carries `retryAfterMs` for the UI to show.
 */
export function retryDelayMs(attempt: number, error: unknown, policy: RetryPolicy): number | null {
  if (error instanceof ProblemError && error.retryAfterMs !== undefined) {
    return error.retryAfterMs > policy.maxDelayMs ? null : error.retryAfterMs;
  }
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.round(policy.random() * ceiling);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => new NetworkError('The request was aborted while waiting to retry');
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    // Only ever called from the abort listener below, so `timer` is assigned by then.
    function fail(): void {
      clearTimeout(timer);
      reject(aborted());
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', fail);
      resolve();
    }, ms);
    signal?.addEventListener('abort', fail, { once: true });
  });
}
