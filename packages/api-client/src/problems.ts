// Every failure this client raises is one of these. A caller branches on `problem.code`, never on
// `title` or `detail`, which are human copy the backend may reword at any time.
import {
  isProblemDetails,
  knownProblemCode,
  type ProblemCode,
  type ReceivedProblem,
} from '@komtru/shared-types';
import type { z } from 'zod';

/** Copied from the backend, which is the only side that may rename them. */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const REPLAYED_HEADER = 'Idempotent-Replayed';
export const REQUEST_ID_HEADER = 'X-Request-Id';
export const RETRY_AFTER_HEADER = 'Retry-After';

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export interface ResponseMeta {
  status: number;
  requestId: string | undefined;
  /** The server answered from a stored idempotent result rather than running the handler again. */
  replayed: boolean;
  retryAfterMs: number | undefined;
  rateLimit: RateLimitInfo | undefined;
}

export class ApiClientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The request never produced an HTTP response: DNS, a dropped connection, a caller's abort. */
export class NetworkError extends ApiClientError {}

/** The client's own deadline elapsed before the response body was read. */
export class TimeoutError extends NetworkError {}

/** A 2xx whose body does not match the endpoint's response schema: the server broke its contract. */
export class ResponseShapeError extends ApiClientError {
  constructor(
    message: string,
    readonly issues: readonly z.core.$ZodIssue[],
    readonly meta: ResponseMeta,
  ) {
    super(message);
  }
}

export class ProblemError extends ApiClientError {
  readonly status: number;
  readonly code: string;
  /** Set only when this client version knows the code; otherwise fall back to generic handling. */
  readonly knownCode: ProblemCode | undefined;
  /** True when the server sent something that was not problem details and this was invented from it. */
  readonly synthetic: boolean;
  readonly requestId: string | undefined;
  readonly retryAfterMs: number | undefined;
  readonly rateLimit: RateLimitInfo | undefined;
  readonly replayed: boolean;

  constructor(
    readonly problem: ReceivedProblem,
    meta: ResponseMeta,
    synthetic: boolean,
  ) {
    super(problem.title);
    this.status = problem.status;
    this.code = problem.code;
    this.knownCode = knownProblemCode(problem);
    this.synthetic = synthetic;
    this.requestId = meta.requestId;
    this.retryAfterMs = meta.retryAfterMs;
    this.rateLimit = meta.rateLimit;
    this.replayed = meta.replayed;
  }

  is(code: ProblemCode): boolean {
    return this.code === code;
  }
}

const integerHeader = (headers: Headers, name: string): number | undefined => {
  const raw = headers.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) ? value : undefined;
};

/** `Retry-After` is either delta-seconds or an HTTP-date (RFC 9110 §10.2.3); both appear in the wild. */
const retryAfterMs = (headers: Headers, now: () => number): number | undefined => {
  const raw = headers.get(RETRY_AFTER_HEADER);
  if (raw === null) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const at = Date.parse(raw);
  // A date already in the past means "now", not a negative wait.
  return Number.isNaN(at) ? undefined : Math.max(0, at - now());
};

const rateLimitInfo = (headers: Headers): RateLimitInfo | undefined => {
  const limit = integerHeader(headers, 'RateLimit-Limit');
  const remaining = integerHeader(headers, 'RateLimit-Remaining');
  const resetSeconds = integerHeader(headers, 'RateLimit-Reset');
  if (limit === undefined || remaining === undefined || resetSeconds === undefined) return undefined;
  return { limit, remaining, resetSeconds };
};

export const readResponseMeta = (
  headers: Headers,
  status: number,
  now: () => number = Date.now,
): ResponseMeta => ({
  status,
  requestId: headers.get(REQUEST_ID_HEADER) ?? undefined,
  replayed: headers.get(REPLAYED_HEADER) === 'true',
  retryAfterMs: retryAfterMs(headers, now),
  rateLimit: rateLimitInfo(headers),
});

const STATUS_TITLES: Record<number, string> = {
  400: 'The request could not be processed',
  401: 'Not signed in',
  403: 'Not allowed',
  404: 'Not found',
  408: 'The request timed out',
  409: 'Conflict',
  429: 'Too many requests',
  500: 'Something went wrong',
  502: 'The service is unreachable',
  503: 'The service is unavailable',
  504: 'The service timed out',
};

/**
 * A load balancer's HTML error page, a gateway's plain text, an empty body: none of these are
 * problem details, but the caller still needs one shape to branch on. `synthetic` says the server
 * did not say this, so nothing downstream should treat `code` as a promise.
 */
/** Mapped from the status alone, so a proxy's 403 never arrives labelled a validation failure. */
const SYNTHETIC_CODES: Record<number, ProblemCode> = {
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

const synthesise = (status: number): ReceivedProblem => ({
  type: 'about:blank',
  title: STATUS_TITLES[status] ?? 'The request failed',
  status,
  code: SYNTHETIC_CODES[status] ?? (status >= 400 && status < 500 ? 'VALIDATION_FAILED' : 'INTERNAL'),
});

export function problemFromResponse(status: number, body: unknown, meta: ResponseMeta): ProblemError {
  // The status on the wire wins over the one in the body: a proxy can only rewrite the former.
  if (isProblemDetails(body)) return new ProblemError({ ...body, status }, meta, false);
  return new ProblemError(synthesise(status), meta, true);
}
