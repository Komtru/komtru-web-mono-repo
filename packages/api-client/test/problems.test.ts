import { describe, expect, it } from 'vitest';
import { problemFromResponse, ProblemError, readResponseMeta } from '../src/problems.js';

describe('readResponseMeta', () => {
  it('reads the request id, the replay marker and the rate-limit headers', () => {
    const meta = readResponseMeta(
      new Headers({
        'X-Request-Id': 'req-1',
        'Idempotent-Replayed': 'true',
        'RateLimit-Limit': '10',
        'RateLimit-Remaining': '0',
        'RateLimit-Reset': '5',
      }),
      200,
    );
    expect(meta.requestId).toBe('req-1');
    expect(meta.replayed).toBe(true);
    expect(meta.rateLimit).toEqual({ limit: 10, remaining: 0, resetSeconds: 5 });
  });

  it('leaves everything absent when the server sent no metadata', () => {
    const meta = readResponseMeta(new Headers(), 200);
    expect(meta).toEqual({
      status: 200,
      requestId: undefined,
      replayed: false,
      retryAfterMs: undefined,
      rateLimit: undefined,
    });
  });

  it('reads Retry-After in seconds', () => {
    expect(readResponseMeta(new Headers({ 'Retry-After': '30' }), 429).retryAfterMs).toBe(30_000);
  });

  it('reads Retry-After given as an HTTP-date', () => {
    const now = () => Date.parse('2026-10-05T12:00:00.000Z');
    const at = new Date('2026-10-05T12:00:30.000Z').toUTCString();
    expect(readResponseMeta(new Headers({ 'Retry-After': at }), 503, now).retryAfterMs).toBe(30_000);
  });

  it('clamps an HTTP-date already in the past to no wait', () => {
    const now = () => Date.parse('2026-10-05T12:00:00.000Z');
    const at = new Date('2026-10-05T11:59:00.000Z').toUTCString();
    expect(readResponseMeta(new Headers({ 'Retry-After': at }), 503, now).retryAfterMs).toBe(0);
  });

  it('ignores a Retry-After it cannot read', () => {
    expect(readResponseMeta(new Headers({ 'Retry-After': 'soon' }), 503).retryAfterMs).toBeUndefined();
  });
});

describe('problemFromResponse', () => {
  const meta = (headers: Record<string, string> = {}, status = 409) =>
    readResponseMeta(new Headers(headers), status);

  it('surfaces a known problem code with its status and request id', () => {
    const error = problemFromResponse(
      409,
      { type: 'about:blank', title: 'Nope', status: 409, code: 'INVALID_TRANSITION' },
      meta({ 'X-Request-Id': 'req-1' }),
    );
    expect(error).toBeInstanceOf(ProblemError);
    expect(error.knownCode).toBe('INVALID_TRANSITION');
    expect(error.is('INVALID_TRANSITION')).toBe(true);
    expect(error.is('CONFLICT')).toBe(false);
    expect(error.status).toBe(409);
    expect(error.synthetic).toBe(false);
    expect(error.requestId).toBe('req-1');
  });

  it('keeps a code a newer server added, with no known code', () => {
    const error = problemFromResponse(
      409,
      { type: 'about:blank', title: 'Already released', status: 409, code: 'PARCEL_ALREADY_RELEASED' },
      meta(),
    );
    expect(error.code).toBe('PARCEL_ALREADY_RELEASED');
    expect(error.knownCode).toBeUndefined();
    expect(error.synthetic).toBe(false);
  });

  it('synthesises a problem when the body is not problem details', () => {
    const error = problemFromResponse(502, '<html>bad gateway</html>', meta({}, 502));
    expect(error.synthetic).toBe(true);
    expect(error.knownCode).toBe('INTERNAL');
    expect(error.status).toBe(502);
    expect(error.problem.status).toBe(502);
  });

  it('never labels a synthetic problem with a code the status contradicts', () => {
    // A proxy's own 403 page must not reach a caller branching on `code` as VALIDATION_FAILED.
    expect(problemFromResponse(403, 'Forbidden', meta({}, 403)).knownCode).toBe('FORBIDDEN');
    expect(problemFromResponse(401, '', meta({}, 401)).knownCode).toBe('UNAUTHENTICATED');
    expect(problemFromResponse(404, '', meta({}, 404)).knownCode).toBe('NOT_FOUND');
    expect(problemFromResponse(429, '', meta({}, 429)).knownCode).toBe('RATE_LIMITED');
    expect(problemFromResponse(418, '', meta({}, 418)).knownCode).toBe('VALIDATION_FAILED');
    expect(problemFromResponse(504, '', meta({}, 504)).knownCode).toBe('INTERNAL');
  });

  it('carries Retry-After and the rate-limit budget on a 429', () => {
    const error = problemFromResponse(
      429,
      { type: 'about:blank', title: 'Too many requests', status: 429, code: 'RATE_LIMITED' },
      meta(
        { 'Retry-After': '2', 'RateLimit-Limit': '5', 'RateLimit-Remaining': '0', 'RateLimit-Reset': '2' },
        429,
      ),
    );
    expect(error.retryAfterMs).toBe(2_000);
    expect(error.rateLimit?.remaining).toBe(0);
  });
});
