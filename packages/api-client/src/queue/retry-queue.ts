// A park agent works where there is no signal. The queue is what lets the app say "received" and
// "released" honestly while the phone has nothing to send them over.
//
// Two rules decide everything here:
//
//   1. Replay is strictly in enqueue order, one at a time, and a failure a repeat can fix *blocks*
//      the queue. Head-of-line blocking is the point: "parcel released" must never reach the server
//      before "parcel received", because the trade's state machine would reject it.
//   2. A failure a repeat cannot fix — a 403, a 422, a validation error — drops the entry and the
//      queue carries on. One dead request must not strand every later one forever; the UI is told
//      so an agent can see what did not go through.
import { createIdempotencyKey, assertIdempotencyKey } from '../idempotency.js';
import type { ApiClient } from '../client.js';
import type { AnyEndpoint } from '../contracts.js';
import { DEFAULT_RETRY_POLICY, isRetryable, retryDelayMs } from '../retry.js';
import { createMemoryQueueStore } from './memory-store.js';
import type { QueueEvent, QueuedRequest, QueueStore } from './types.js';

export const DEFAULT_QUEUE_MAX_ATTEMPTS = 10;

export interface RetryQueueOptions {
  client: ApiClient;
  /** Only endpoints the backend marked `retryable`; anything else cannot be replayed safely. */
  endpoints: Record<string, AnyEndpoint>;
  store?: QueueStore;
  onEvent?: (event: QueueEvent) => void;
  maxAttempts?: number;
  newId?: () => string;
  now?: () => number;
}

export interface EnqueueOptions {
  /** Continue an action that already has a key — a direct call that timed out, say. */
  idempotencyKey?: string;
}

export interface RetryQueue {
  enqueue: (endpoint: string, input: unknown, options?: EnqueueOptions) => Promise<QueuedRequest>;
  /** Single-flight: a second caller joins the pass already running. */
  flush: () => Promise<void>;
  pending: () => Promise<QueuedRequest[]>;
  clear: () => Promise<void>;
  close: () => Promise<void>;
}

export function createRetryQueue({
  client,
  endpoints,
  store = createMemoryQueueStore(),
  onEvent,
  maxAttempts = DEFAULT_QUEUE_MAX_ATTEMPTS,
  newId = createIdempotencyKey,
  now = Date.now,
}: RetryQueueOptions): RetryQueue {
  let flushing: Promise<void> | null = null;

  const endpointFor = (name: string): AnyEndpoint => {
    const endpoint = endpoints[name];
    if (!endpoint) throw new TypeError(`The retry queue does not know an endpoint called "${name}"`);
    if (!endpoint.retryable) {
      throw new TypeError(
        `"${name}" is not marked retryable by the backend, so a replay could act twice; call it directly instead`,
      );
    }
    return endpoint;
  };

  const enqueue = async (
    endpoint: string,
    input: unknown,
    options: EnqueueOptions = {},
  ): Promise<QueuedRequest> => {
    endpointFor(endpoint);
    const entry = await store.add({
      id: newId(),
      endpoint,
      input,
      idempotencyKey:
        options.idempotencyKey === undefined
          ? createIdempotencyKey()
          : assertIdempotencyKey(options.idempotencyKey),
      enqueuedAt: now(),
      attempts: 0,
    });
    onEvent?.({ type: 'enqueued', entry });
    return entry;
  };

  const runFlush = async (): Promise<void> => {
    for (;;) {
      const [entry] = await store.list();
      if (!entry) break;

      let data: unknown;
      try {
        data = await client.call(
          endpointFor(entry.endpoint),
          entry.input as never,
          // The key the entry was born with, never a fresh one: that is the whole promise.
          { idempotencyKey: entry.idempotencyKey },
        );
      } catch (error) {
        const attempts = entry.attempts + 1;
        const attempted: QueuedRequest = {
          ...entry,
          attempts,
          lastError: error instanceof Error ? error.message : String(error),
        };

        // `true`, not `isRetryable(error, false)`: the entry carries a key, so every attempt is the
        // same request and the server will replay rather than act twice.
        if (!isRetryable(error, true) || attempts >= maxAttempts) {
          await store.remove(entry.id);
          onEvent?.({ type: 'dropped', entry: attempted, error });
          continue;
        }

        await store.update(attempted);
        onEvent?.({ type: 'retrying', entry: attempted, error });
        // Stop the pass rather than skipping ahead: order is the guarantee.
        return;
      }

      await store.remove(entry.id);
      onEvent?.({ type: 'sent', entry, data });
    }
    onEvent?.({ type: 'idle' });
  };

  const flush = (): Promise<void> => {
    flushing ??= runFlush().finally(() => {
      flushing = null;
    });
    return flushing;
  };

  return {
    enqueue,
    flush,
    pending: () => store.list(),
    clear: () => store.clear(),
    close: () => store.close(),
  };
}

/**
 * The backoff a caller should wait before the next `flush()` after a `retrying` event. A server that
 * asked for longer than the policy allows is capped rather than refused: unlike a live call, nobody
 * is waiting on this promise, so the queue can afford the full wait.
 */
export const queueRetryDelayMs = (entry: QueuedRequest, error: unknown, random = Math.random): number => {
  const policy = { ...DEFAULT_RETRY_POLICY, random };
  return retryDelayMs(entry.attempts - 1, error, policy) ?? policy.maxDelayMs;
};
