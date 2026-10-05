// Where the three retry stories meet. One `call()` is one user action:
//
//   * its Idempotency-Key is minted once and sent on every attempt, with the same body, so the
//     server's idempotency gate replays the first result instead of acting twice;
//   * a 401 buys exactly one refresh-and-retry, and the refresh is single-flight across every call
//     in the process, so twenty requests that all 401 together produce one refresh;
//   * everything else a repeat can fix goes through the retry policy, which only ever retries a
//     mutation that carries a key.
import type { SessionScope } from '@komtru/shared-types';
import type { TokenStore } from './auth/session.js';
import {
  buildPath,
  buildQuery,
  type AnyEndpoint,
  type EndpointInput,
  type EndpointOutput,
} from './contracts.js';
import { assertIdempotencyKey, createIdempotencyKey } from './idempotency.js';
import { IDEMPOTENCY_HEADER, ProblemError, type ResponseMeta } from './problems.js';
import {
  DEFAULT_RETRY_POLICY,
  isRetryable,
  retryDelayMs,
  sleep as realSleep,
  type RetryPolicy,
} from './retry.js';
import { createTransport, type Transport, type TransportOptions } from './transport.js';

const READ_METHODS = new Set(['get', 'head']);

export interface ApiClientOptions extends Omit<TransportOptions, 'baseUrl'> {
  baseUrl: string;
  tokens?: TokenStore;
  retry?: Partial<RetryPolicy>;
  /** Injected so a test can assert the backoff without waiting for it. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onResponse?: (meta: ResponseMeta) => void;
}

export interface CallOptions {
  /**
   * Supply this when the attempt continues an earlier user action: a "try again" tap, or a replay
   * from the durable queue. Omit it and one is minted per call for a retryable endpoint.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface CallResult<T> {
  data: T;
  meta: ResponseMeta;
  /** The key this call used, so a caller can persist it and continue the action later. */
  idempotencyKey: string | undefined;
}

export interface ApiClient {
  call: <E extends AnyEndpoint>(
    endpoint: E,
    input: EndpointInput<E>,
    options?: CallOptions,
  ) => Promise<EndpointOutput<E>>;
  callWithMeta: <E extends AnyEndpoint>(
    endpoint: E,
    input: EndpointInput<E>,
    options?: CallOptions,
  ) => Promise<CallResult<EndpointOutput<E>>>;
  transport: Transport;
  tokens: TokenStore | undefined;
  /** Which session scope this client's endpoints expect; set by the app that builds it. */
  scope: SessionScope | undefined;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const { tokens, retry, sleep = realSleep, onResponse, ...transportOptions } = options;
  const transport = createTransport(transportOptions);
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...retry };

  const callWithMeta = async <E extends AnyEndpoint>(
    endpoint: E,
    input: EndpointInput<E>,
    callOptions: CallOptions = {},
  ): Promise<CallResult<EndpointOutput<E>>> => {
    const typed: AnyEndpoint = endpoint;
    const path = `${buildPath(typed.path, input.params as Record<string, string | number> | undefined)}${buildQuery(input.query)}`;

    // Minted once, here, and reused by every attempt below. This is the whole idempotency story.
    const idempotencyKey = typed.retryable
      ? callOptions.idempotencyKey === undefined
        ? createIdempotencyKey()
        : assertIdempotencyKey(callOptions.idempotencyKey)
      : undefined;
    const idempotent = READ_METHODS.has(typed.method) || idempotencyKey !== undefined;

    let refreshed = false;
    let attempt = 0;

    for (;;) {
      const snapshot = tokens?.read();
      const headers: Record<string, string> = { ...callOptions.headers };
      if (snapshot?.accessToken) headers.Authorization = `Bearer ${snapshot.accessToken}`;
      if (idempotencyKey !== undefined) headers[IDEMPOTENCY_HEADER] = idempotencyKey;

      try {
        const result = await transport.send<EndpointOutput<E>>({
          method: typed.method,
          path,
          headers,
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(callOptions.signal ? { signal: callOptions.signal } : {}),
          ...(typed.schema.response ? { responseSchema: typed.schema.response } : {}),
        });
        onResponse?.(result.meta);
        return { data: result.data, meta: result.meta, idempotencyKey };
      } catch (error) {
        if (error instanceof ProblemError) onResponse?.(responseMetaOf(error));

        // One refresh-and-retry per call. The refresh does not spend a policy attempt: a token
        // expiring mid-session is normal, not a failure worth burning the budget on.
        if (
          error instanceof ProblemError &&
          error.status === 401 &&
          tokens !== undefined &&
          snapshot !== undefined &&
          !refreshed
        ) {
          refreshed = true;
          const next = await tokens.refreshOnce(snapshot.generation);
          // No token afterwards means the refresh credential is gone: the session really is over.
          if (next.accessToken !== null) continue;
        }

        attempt += 1;
        if (attempt >= policy.maxAttempts || !isRetryable(error, idempotent)) throw error;
        await sleep(retryDelayMs(attempt - 1, error, policy), callOptions.signal);
      }
    }
  };

  const call = async <E extends AnyEndpoint>(
    endpoint: E,
    input: EndpointInput<E>,
    callOptions?: CallOptions,
  ): Promise<EndpointOutput<E>> => (await callWithMeta(endpoint, input, callOptions)).data;

  return { call, callWithMeta, transport, tokens, scope: undefined };
}

const responseMetaOf = (error: ProblemError): ResponseMeta => ({
  status: error.status,
  requestId: error.requestId,
  replayed: error.replayed,
  retryAfterMs: error.retryAfterMs,
  rateLimit: error.rateLimit,
});
