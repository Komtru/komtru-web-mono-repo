// The one way the backend talks to an outbound provider (design §4.4).
//
// Every provider call runs inside a BullMQ job (see src/platform/queue/factory.ts), so a retry here is
// a cheap in-attempt retry and the queue's own backoff is the real safety net. Only a call the caller
// declares safe to repeat is retried: a POST that is not idempotent and times out may already have
// charged someone.
//
// Nothing from a request or response body is logged. Provider bodies carry card data, bank details and
// API keys, and a single careless log line puts them in the log store forever.
import type { Logger } from '../logger.js';

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BACKOFF_MS = 200;

export type ProviderHttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ProviderRequest {
  /** Provider name as it appears in logs and metrics, e.g. `paystack`. */
  provider: string;
  /** Stable operation name, e.g. `charge.verify`. Logged instead of the path, which carries ids. */
  operation: string;
  method: ProviderHttpMethod;
  url: string;
  headers?: Record<string, string>;
  /** Serialised as JSON when present. */
  body?: unknown;
  /** Deadline for one attempt, not for the call as a whole. */
  timeoutMs?: number;
  /** GET and HEAD are idempotent by method; anything else must say so (it carries a provider key). */
  idempotent?: boolean;
  maxAttempts?: number;
  /** First retry delay; doubles per attempt, as the queue factory's backoff does. */
  backoffMs?: number;
  /** The caller's own cancellation, e.g. a job being drained at shutdown. */
  signal?: AbortSignal;
}

export interface ProviderResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  /** Parsed JSON when the provider says JSON, otherwise the raw text. */
  body: T;
}

/** The provider answered, and said no. */
export class ProviderHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly operation: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`${provider}: ${operation} failed with status ${status}`);
    this.name = 'ProviderHttpError';
  }
}

/** The provider did not answer in time, could not be reached, or is being given a rest. */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly provider: string,
    readonly operation: string,
    readonly reason: 'timeout' | 'network' | 'circuit-open',
    options?: { cause?: unknown },
  ) {
    super(`${provider}: ${operation} unavailable (${reason})`, options);
    this.name = 'ProviderUnavailableError';
  }
}

const REDACTED = '[redacted]';
const SECRET_PARAM = /(key|secret|token|signature|password|pin|hash)/i;
const SECRET_HEADER = /^(authorization|cookie|set-cookie)$|api[-_]?key|secret|token|signature|hash/i;

/** Strips credentials from a URL so it can be logged: userinfo and secret-looking query values. */
export function redactUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '[unparseable url]';
  }
  if (parsed.username || parsed.password) {
    parsed.username = REDACTED;
    parsed.password = '';
  }
  for (const name of [...parsed.searchParams.keys()]) {
    if (SECRET_PARAM.test(name)) parsed.searchParams.set(name, REDACTED);
  }
  // URL escapes the brackets of the placeholder; undo that so the log line reads plainly.
  return parsed.toString().replaceAll('%5Bredacted%5D', REDACTED);
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, SECRET_HEADER.test(name) ? REDACTED : value]),
  );
}

/**
 * pino's error serialiser copies an error's own properties, which for a ProviderHttpError would put the
 * provider's response body in the log. Only the shape of the failure is logged.
 */
const loggableError = (error: unknown) => {
  if (error instanceof ProviderHttpError) {
    return { type: error.name, message: error.message, status: error.status };
  }
  if (error instanceof ProviderUnavailableError) {
    return { type: error.name, message: error.message, reason: error.reason };
  }
  return error instanceof Error ? { type: error.name, message: error.message } : { type: 'unknown' };
};

const isRetryableFailure = (error: unknown): boolean =>
  error instanceof ProviderUnavailableError ||
  (error instanceof ProviderHttpError && (error.status === 429 || error.status >= 500));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text === '') return undefined;
  if (!response.headers.get('content-type')?.includes('json')) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A provider that promises JSON and sends an HTML error page is still worth surfacing verbatim.
    return text;
  }
};

async function attemptOnce(request: ProviderRequest, timeoutMs: number): Promise<ProviderResponse> {
  const { provider, operation, method, url, headers = {}, body, signal } = request;
  const deadline = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal ? AbortSignal.any([deadline, signal]) : deadline,
  }).catch((error: unknown) => {
    // The caller's cancellation is theirs: surface it untouched so it is never mistaken for a retryable
    // provider failure.
    if (signal?.aborted) throw signal.reason;
    if (deadline.aborted)
      throw new ProviderUnavailableError(provider, operation, 'timeout', { cause: error });
    throw new ProviderUnavailableError(provider, operation, 'network', { cause: error });
  });

  const parsed = await readBody(response);
  if (!response.ok) throw new ProviderHttpError(provider, operation, response.status, parsed);
  return { status: response.status, headers: Object.fromEntries(response.headers), body: parsed };
}

/**
 * Calls a provider. Resolves on 2xx, throws ProviderHttpError on anything else, and
 * ProviderUnavailableError when the provider did not answer.
 */
export async function providerRequest<T = unknown>(
  logger: Logger,
  request: ProviderRequest,
): Promise<ProviderResponse<T>> {
  const {
    provider,
    operation,
    method,
    url,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    backoffMs = DEFAULT_BACKOFF_MS,
  } = request;
  const idempotent = request.idempotent ?? (method === 'GET' || method === 'HEAD');
  const attempts = idempotent ? Math.max(1, maxAttempts) : 1;
  const base = { provider, operation, method, url: redactUrl(url) };

  for (let attempt = 1; ; attempt++) {
    const startedAt = Date.now();
    try {
      const response = await attemptOnce(request, timeoutMs);
      logger.debug(
        { ...base, attempt, status: response.status, durationMs: Date.now() - startedAt },
        'provider: ok',
      );
      return response as ProviderResponse<T>;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const status = error instanceof ProviderHttpError ? error.status : undefined;
      const fields = {
        ...base,
        attempt,
        durationMs,
        ...(status ? { status } : {}),
        err: loggableError(error),
      };
      if (attempt >= attempts || !isRetryableFailure(error)) {
        logger.error(fields, 'provider: call failed');
        throw error;
      }
      logger.warn(fields, 'provider: attempt failed, retrying');
      await sleep(backoffMs * 2 ** (attempt - 1));
    }
  }
}
