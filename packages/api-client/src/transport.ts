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
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    request.signal?.addEventListener('abort', onCallerAbort, { once: true });

    const headers = new Headers({ Accept: 'application/json', ...defaultHeaders, ...request.headers });
    const hasBody = request.body !== undefined;
    if (hasBody && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    let response: Response;
    try {
      response = await doFetch(joinUrl(baseUrl, request.path), {
        method: request.method.toUpperCase(),
        headers,
        signal: controller.signal,
        ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
        ...(credentials ? { credentials } : {}),
      });
    } catch (cause) {
      // The deadline covers reading the body too, so the timer stays armed until that is done.
      if (timedOut) throw new TimeoutError(`The request to ${request.path} timed out`, { cause });
      throw new NetworkError(`The request to ${request.path} could not be sent`, { cause });
    } finally {
      request.signal?.removeEventListener('abort', onCallerAbort);
    }

    let body: unknown;
    try {
      body = await decodeBody(response);
    } catch (cause) {
      if (timedOut) throw new TimeoutError(`The response to ${request.path} timed out`, { cause });
      throw new NetworkError(`The response to ${request.path} could not be read`, { cause });
    } finally {
      clearTimeout(timer);
    }

    const meta = readResponseMeta(response.headers, response.status, now);
    if (!response.ok) throw problemFromResponse(response.status, body, meta);

    if (!request.responseSchema) return { data: body as T, meta };
    const parsed = request.responseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ResponseShapeError(
        `${request.method.toUpperCase()} ${request.path} returned a response that does not match its schema`,
        parsed.error.issues,
        meta,
      );
    }
    return { data: parsed.data as T, meta };
  };

  return { send, baseUrl };
}
