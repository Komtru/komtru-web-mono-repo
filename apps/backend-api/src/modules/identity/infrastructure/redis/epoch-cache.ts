// The Redis half of M1 D5's kill switch: `users.sessions_epoch`, cached for a few seconds so a token
// stamped with a dead epoch is refused without a database query.
//
// What this cache can and cannot do, exactly. It can only make a rejection EARLIER. It can never
// make an acceptance possible, because `resolvePrincipal` reads the authoritative epoch back in the
// same query that fetches the session and compares it again. A missed invalidation, a Redis outage
// and a stale entry therefore all cost latency and nothing else — which is why `read` treats an
// error as a miss instead of failing the request.
import type { Redis } from 'ioredis';
import type { Logger } from '../../../../platform/logger.js';

/** Under the client's own `komtru:` prefix, so the real key is `komtru:identity:epoch:<uuid>`. */
const key = (userId: string): string => `identity:epoch:${userId}`;

export interface EpochCache {
  read: (userId: string) => Promise<number | undefined>;
  write: (userId: string, epoch: number) => Promise<void>;
  invalidate: (userId: string) => Promise<void>;
}

export function createEpochCache(redis: Redis, ttlSeconds: number, logger: Logger): EpochCache {
  const swallow = (error: unknown, action: string): undefined => {
    logger.warn({ err: error }, `identity: could not ${action} the session epoch cache`);
    return undefined;
  };

  return {
    read: async (userId) => {
      const raw = await redis.get(key(userId)).catch((error: unknown) => swallow(error, 'read'));
      if (raw === null || raw === undefined) return undefined;
      const epoch = Number(raw);
      return Number.isInteger(epoch) ? epoch : undefined;
    },

    write: async (userId, epoch) => {
      await redis
        .set(key(userId), String(epoch), 'EX', ttlSeconds)
        .catch((error: unknown) => swallow(error, 'write'));
    },

    invalidate: async (userId) => {
      await redis.del(key(userId)).catch((error: unknown) => swallow(error, 'invalidate'));
    },
  };
}
