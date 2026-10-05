// One request, one response, no retries and no auth: everything that varies per attempt lives here,
// everything that decides whether there should be another attempt lives in client.ts.
import type { z } from 'zod';
import type { HttpMethod } from './contracts.js';
import {
  NetworkError,
  problemFromResponse,
  readResponseMeta,
  ResponseShapeError,
  TimeoutError,
  type ResponseMeta,
} from './problems.js';

export const DEFAULT_TIMEOUT_MS = 15_000;

export interface TransportOptions {
  /** Where `/v1` lives: `https://api.komtru.com/v1` or the app's own proxy path. */
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
  /** `include` when the app proxies and the session rides a cookie; omitted otherwise. */
  credentials?: RequestCredentials;
  now?: () => number;
}

export interface TransportRequest {
  method: HttpMethod;
  /** Already interpolated and query-stringed; the transport only joins it to the base URL. */
  path: string;
  body?: unknown;
  /**
   * A body serialised once by the caller and sent byte-for-byte. The idempotency gate hashes the
   * body, so every attempt of one user action must send exactly the same bytes — even if the
   * caller's object was mutated while the client was backing off.
   */
  serialisedBody?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  responseSchema?: z.ZodType;
}

export interface TransportResult<T> {
  data: T;
  meta: ResponseMeta;
}

export interface Transport {
  send: <T = unknown>(request: TransportRequest) => Promise<TransportResult<T>>;
  baseUrl: string;
}

const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

/** An empty body is not a parse failure: a 204 and a 200 with no content both mean "nothing". */
const decodeBody = async (response: Response): Promise<unknown> => {
  if (response.status === 204 || response.status === 205) return undefined;
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A gateway's HTML, a plain-text 502: hand the raw text on so the problem can be synthesised.
    return text;
  }
};

export function createTransport({
  baseUrl,
  fetch: fetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  defaultHeaders,
  credentials,
  now = Date.now,
}: TransportOptions): Transport {
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);

  const send = async <T>(request: TransportRequest): Promise<TransportResult<T>> => {
    // A signal that is already aborted never fires `abort` again, so without this check the caller's
    // cancellation would be ignored and the request would go out anyway.
    if (request.signal?.aborted) {
      throw new NetworkError(`The request to ${request.path} was aborted before it was sent`);
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    request.signal?.addEventListener('abort', onCallerAbort, { once: true });

    const headers = new Headers({ Accept: 'application/json', ...defaultHeaders, ...request.headers });
    const hasBody = request.serialisedBody !== undefined || request.body !== undefined;
    if (hasBody && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const body = request.serialisedBody ?? (hasBody ? JSON.stringify(request.body) : undefined);

    try {
      let response: Response;
      try {
        response = await doFetch(joinUrl(baseUrl, request.path), {
          method: request.method.toUpperCase(),
          headers,
          signal: controller.signal,
          ...(body !== undefined ? { body } : {}),
          ...(credentials ? { credentials } : {}),
        });
      } catch (cause) {
        if (timedOut) throw new TimeoutError(`The request to ${request.path} timed out`, { cause });
        throw new NetworkError(`The request to ${request.path} could not be sent`, { cause });
      }

      // The deadline and the caller's signal both still apply here: a server that sends headers and
      // then stalls mid-body is exactly the failure a header-only timeout misses.
      let payload: unknown;
      try {
        payload = await decodeBody(response);
      } catch (cause) {
        if (timedOut) throw new TimeoutError(`The response to ${request.path} timed out`, { cause });
        throw new NetworkError(`The response to ${request.path} could not be read`, { cause });
      }

      const meta = readResponseMeta(response.headers, response.status, now);
      if (!response.ok) throw problemFromResponse(response.status, payload, meta);

      if (!request.responseSchema) return { data: payload as T, meta };
      const parsed = request.responseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ResponseShapeError(
          `${request.method.toUpperCase()} ${request.path} returned a response that does not match its schema`,
          parsed.error.issues,
          meta,
        );
      }
      return { data: parsed.data as T, meta };
    } finally {
      // One place, so a rejected fetch cannot leave a 15-second timer holding the event loop open.
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onCallerAbort);
    }
  };

  return { send, baseUrl };
}
