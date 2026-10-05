// The exact bytes of an inbound provider webhook, kept for its signature check.
//
// A provider signs the body it sent. `express.json()` hands the handler a parsed object, and
// re-serialising that object does not reproduce those bytes: key order, whitespace and the escaping of
// non-ASCII characters are all free choices the parser does not preserve. A signature checked against a
// reparsed body therefore fails for some deliveries and passes for others, which is the worst possible
// failure mode for an authentication check.
//
// Capture is scoped to the webhook mount rather than applied to every request. The alternative — keeping
// each request's bytes alongside its parsed form for the life of the request — doubles the memory every
// POST holds, to the benefit of the handful of routes that are webhooks. The body limit is unchanged, so
// what is retained is still bounded by it.
import type { Request, Response } from 'express';
import { ApiError } from '../errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** The bytes as they arrived; set only for routes under WEBHOOK_PATH_PREFIX. */
    rawBody?: Buffer;
  }
}

/** Inbound provider webhooks are mounted here, e.g. `POST /v1/webhooks/paystack` (m8 §8). */
export const WEBHOOK_PATH_PREFIX = '/v1/webhooks/';

/** body-parser's `verify` hook: it runs on the collected buffer, before any parsing. */
export function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  if (req.originalUrl.startsWith(WEBHOOK_PATH_PREFIX)) req.rawBody = buf;
}

/**
 * The raw body, or a 400.
 *
 * An absent buffer means the request never went through the JSON parser (a different content type, an
 * empty body) — so there is nothing to verify a signature against. Treating that as "no signature" and
 * rejecting is the only safe reading; returning an empty buffer would hand the verifier a body the
 * sender never signed.
 */
export function rawBody(req: Request): Buffer {
  if (!req.rawBody) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'The request raw body is missing or unreadable');
  }
  return req.rawBody;
}
