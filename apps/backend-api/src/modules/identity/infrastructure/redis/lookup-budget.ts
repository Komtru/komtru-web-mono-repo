// §8.3 control 3's DAY and MONTH budgets for party lookup.
//
// The minute budgets are not here: the route's `rateLimit` spec counts per IP, per user and per
// device at the minute horizon and refuses before the handler ever runs, which is where a burst
// should die. `RateLimitSpec` carries ONE window per key, though (`perKey` overrides the window, it
// does not add a second), so the day and the month have nowhere else to live — and they are the
// horizons that matter: ten email lookups a minute, forever, is fourteen thousand addresses a day
// probed against the directory, which is the enumeration §8 exists to stop.
//
// The subjects are the caller's user id and their IP, and NOT their device fingerprint. A
// fingerprint is a spoofable signal (§S15), so a day-long budget on one is evaded by editing a
// header, while a day-long budget on a contact-verified account is bounded by the cost of a real
// phone number and a real inbox. The device key keeps the minute budget, where its value is real.
import type { Redis } from 'ioredis';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { ApiError } from '../../../../platform/errors.js';
import type { Logger } from '../../../../platform/logger.js';
import type { LookupChannel } from '../../domain/party/lookup.js';

const DAY_SECONDS = 86_400;
const MONTH_SECONDS = 30 * DAY_SECONDS;

export interface LookupWindow {
  name: string;
  points: number;
  durationSeconds: number;
}

/**
 * §8.3 control 3 verbatim: "Username: 30/min, 300/day. Email/phone: 10/min, 50/day, 500/month."
 * The per-minute halves are the routes'; these are the rest.
 */
export const LOOKUP_WINDOWS: Record<LookupChannel, readonly LookupWindow[]> = {
  USERNAME: [{ name: 'day', points: 300, durationSeconds: DAY_SECONDS }],
  EMAIL: [
    { name: 'day', points: 50, durationSeconds: DAY_SECONDS },
    { name: 'month', points: 500, durationSeconds: MONTH_SECONDS },
  ],
  PHONE: [
    { name: 'day', points: 50, durationSeconds: DAY_SECONDS },
    { name: 'month', points: 500, durationSeconds: MONTH_SECONDS },
  ],
};

export interface LookupBudget {
  /**
   * Charges one lookup against every window of `channel` for every subject.
   *
   * Called BEFORE the lookup reads anything and on every path, because a budget charged only on a
   * miss — or only on a hit — would itself be the oracle: the attacker learns the answer from
   * whether their quota moved.
   */
  charge(channel: LookupChannel, subjects: readonly string[]): Promise<void>;
}

const retryAfterSeconds = (msBeforeNext: number): number => Math.max(1, Math.ceil(msBeforeNext / 1000));

/** For unit tests and route-declaration tests, which have no Redis and charge nothing. */
export const NO_LOOKUP_BUDGET: LookupBudget = { charge: () => Promise.resolve() };

export function createLookupBudget(redis: Redis, logger: Logger): LookupBudget {
  const limiters = new Map<string, RateLimiterRedis>();
  const limiterFor = (channel: LookupChannel, window: LookupWindow): RateLimiterRedis => {
    const id = `identity:lookup:${channel}:${window.name}`;
    let limiter = limiters.get(id);
    if (!limiter) {
      limiter = new RateLimiterRedis({
        storeClient: redis,
        keyPrefix: id,
        points: window.points,
        duration: window.durationSeconds,
      });
      limiters.set(id, limiter);
    }
    return limiter;
  };

  return {
    async charge(channel, subjects) {
      for (const window of LOOKUP_WINDOWS[channel]) {
        for (const subject of subjects) {
          if (!subject) continue;
          try {
            await limiterFor(channel, window).consume(subject);
          } catch (error) {
            if (error instanceof RateLimiterRes) {
              logger.warn({ channel, window: window.name }, 'identity: party lookup budget spent');
              throw new ApiError(
                429,
                'RATE_LIMITED',
                'Too many lookups',
                'You have reached the limit for finding people. Try again later.',
                undefined,
                // §10.4's `retryAfter`. The header is set by the platform limiter on the routes it
                // owns; this one is ours, so the number travels in the body.
                { retryAfter: retryAfterSeconds(error.msBeforeNext) },
              );
            }
            // Redis is unreachable. Refusing is the platform limiter's policy and the right one
            // here for the same reason: this is the endpoint worth grinding.
            logger.error({ err: error, channel }, 'identity: lookup budget unavailable');
            throw new ApiError(503, 'INTERNAL', 'Service temporarily unavailable', 'Try again shortly');
          }
        }
      }
    },
  };
}
