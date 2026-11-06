// The read cache for the dropdown APIs. Redis is a cache in front of Postgres and never a source: a
// Redis outage costs a query and nothing else.
//
// INVALIDATION BY VERSION. Every key carries the catalog version (`geo:v<N>:<what>`), and a change
// increments `geo:version`. One INCR retires every cached page at once, typeahead included, which
// could not be deleted by key because its keys are open-ended (every prefix a user ever typed).
// Retired keys expire on their own TTL.
//
// The race this closes: `remember` reads the version BEFORE it queries Postgres, so a reader that
// loaded pre-commit data can only fill the old version's key, which nobody reads again once the
// writer has bumped it. The TTL is the bound on how long such a key lingers, not on staleness.
import type { Redis } from 'ioredis';
import type { Logger } from '../../../../platform/logger.js';

export const GEO_CACHE_TTL_SECONDS = 600;
const VERSION_KEY = 'geo:version';

export interface GeoCache {
  /** Returns the cached value for `what`, or loads it and caches it. Never throws on Redis. */
  remember<T>(what: string, load: () => Promise<T>): Promise<T>;
  /** For the request path, right after a commit. Best-effort: never throws. */
  invalidate(): Promise<void>;
  /**
   * For the event subscriber. A Redis failure is thrown so the outbox redelivers the event; a
   * second delivery just bumps the version again, which is harmless.
   */
  purge(): Promise<void>;
}

export function createGeoCache(redis: Redis, logger: Logger, ttlSeconds = GEO_CACHE_TTL_SECONDS): GeoCache {
  const version = async (): Promise<string | null> => {
    try {
      return (await redis.get(VERSION_KEY)) ?? '0';
    } catch (error) {
      logger.warn({ err: error }, 'geo: could not read the cache version');
      return null;
    }
  };

  return {
    remember: async <T>(what: string, load: () => Promise<T>): Promise<T> => {
      const current = await version();
      if (current === null) return load();
      const key = `geo:v${current}:${what}`;
      try {
        const hit = await redis.get(key);
        if (hit !== null) return JSON.parse(hit) as T;
      } catch (error) {
        // A mangled or unreadable entry is a miss.
        logger.warn({ err: error }, 'geo: could not read the cache');
      }
      const value = await load();
      try {
        await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      } catch (error) {
        logger.warn({ err: error }, 'geo: could not fill the cache');
      }
      return value;
    },

    invalidate: async () => {
      try {
        await redis.incr(VERSION_KEY);
      } catch (error) {
        logger.warn({ err: error }, 'geo: could not invalidate the cache');
      }
    },

    purge: async () => {
      await redis.incr(VERSION_KEY);
    },
  };
}
