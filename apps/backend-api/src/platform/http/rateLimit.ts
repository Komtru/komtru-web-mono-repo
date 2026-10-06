// Redis-backed rate limiting (design §4.4): auth routes and PIN-attempt endpoints cap attempts
// across the whole fleet, not per process, so adding an API instance never multiplies the budget.
//
// Failure policy: if Redis cannot answer, the request is refused with a 503. Redis is already a hard
// dependency of this API (queues, locks, sockets), and failing open on a login or PIN endpoint would
// turn a cache blip into an open brute-force window.
import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { RateLimitGate } from './mount.js';
import { ANONYMOUS_ACTOR_KEY } from './principal.js';
import { routeLabel, type RateLimitSpec, type RouteDefinition } from './route.js';

/** Under the app's `komtru:` ioredis prefix, so every limiter key is namespaced twice over. */
export const RATE_LIMIT_KEY_PREFIX = 'rl';

export interface RateLimitOptions {
  redis: Redis;
  logger: Logger;
  keyPrefix?: string;
}

type RateLimitKey = RateLimitSpec['by'][number];

/**
 * `identifier` and `device` both come out of the parsed body, so they are charged after validation;
 * the rest go before it.
 */
const PHASE: Record<RateLimitKey, 'before-parse' | 'after-parse'> = {
  ip: 'before-parse',
  user: 'before-parse',
  identifier: 'after-parse',
  device: 'after-parse',
};

const subjectFor = (
  kind: RateLimitKey,
  spec: RateLimitSpec,
  req: Request,
  actor: string,
  parsed?: { body: unknown; query: unknown; params: unknown },
): string | undefined => {
  if (kind === 'ip') return req.ip;
  if (kind === 'user') return actor === ANONYMOUS_ACTOR_KEY ? undefined : actor;
  if (!parsed) return undefined;
  const extract = kind === 'device' ? spec.deviceFrom : spec.identifierFrom;
  return extract?.(parsed)?.toLowerCase();
};

const retryAfterSeconds = (msBeforeNext: number): number => Math.max(1, Math.ceil(msBeforeNext / 1000));

/**
 * With more than one key, the headers must describe the *binding* one — the one with the least left
 * — not whichever was charged last.
 */
const setHeaders = (res: Response, spec: RateLimitSpec, result: RateLimiterRes): void => {
  const remaining = Math.max(0, result.remainingPoints);
  const previous = res.getHeader('RateLimit-Remaining');
  if (previous !== undefined && Number(previous) <= remaining) return;
  res.setHeader('RateLimit-Limit', spec.points);
  res.setHeader('RateLimit-Remaining', remaining);
  res.setHeader('RateLimit-Reset', retryAfterSeconds(result.msBeforeNext));
};

export function createRateLimitGate({
  redis,
  logger,
  keyPrefix = RATE_LIMIT_KEY_PREFIX,
}: RateLimitOptions): RateLimitGate {
  // One limiter per route and window; `storeClient` is the shared app client, so every instance
  // counts into the same Redis keys.
  const limiters = new Map<string, RateLimiterRedis>();
  const limiterFor = (route: RouteDefinition, spec: RateLimitSpec, kind: string): RateLimiterRedis => {
    const id = `${keyPrefix}:${route.method}:${route.path}:${kind}`;
    let limiter = limiters.get(id);
    if (!limiter) {
      limiter = new RateLimiterRedis({
        storeClient: redis,
        keyPrefix: id,
        points: spec.points,
        duration: spec.durationSeconds,
      });
      limiters.set(id, limiter);
    }
    return limiter;
  };

  return async ({ route, req, res, actor, parsed, phase }) => {
    const spec = route.rateLimit;
    if (!spec) return;

    for (const kind of spec.by) {
      if (PHASE[kind] !== phase) continue;
      const subject = subjectFor(kind, spec, req, actor.key, parsed);
      // Nothing to key on (an anonymous caller on a per-user limit, a body with no identifier):
      // skip this key rather than collapsing every such caller into one shared bucket.
      if (!subject) continue;

      try {
        const result = await limiterFor(route, spec, kind).consume(subject);
        setHeaders(res, spec, result);
      } catch (error) {
        if (error instanceof RateLimiterRes) {
          setHeaders(res, spec, error);
          res.setHeader('Retry-After', retryAfterSeconds(error.msBeforeNext));
          logger.warn({ route: routeLabel(route), kind }, 'http: rate limit reached');
          throw new ApiError(
            429,
            'RATE_LIMITED',
            'Too many requests',
            'Wait for the period in Retry-After before trying again',
          );
        }
        // Redis is unreachable or erroring. Refusing is the safe answer on the routes that declare
        // a limit: they are the ones worth brute-forcing.
        logger.error({ err: error, route: routeLabel(route), kind }, 'http: rate limiter unavailable');
        // Something to back off on, so a retrying client or provider webhook is not left guessing.
        res.setHeader('Retry-After', 1);
        throw new ApiError(503, 'INTERNAL', 'Service temporarily unavailable', 'Try again shortly');
      }
    }
  };
}
