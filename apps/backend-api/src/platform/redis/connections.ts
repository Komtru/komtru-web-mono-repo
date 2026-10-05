// Redis connections. Every key the platform writes lives under `komtru:`, so the shared Redis can
// host other tenants (and the old backend) without collisions.
import { Redis } from 'ioredis';

export const KEY_PREFIX = 'komtru:';
/** BullMQ keys: `komtru:bull:<queue>:…`. BullMQ refuses ioredis keyPrefix and takes its own. */
export const BULL_PREFIX = 'komtru:bull';

/** The app's client: commands fail fast rather than queueing while Redis is away. */
export function createRedis(url: string, { prefix = true }: { prefix?: boolean } = {}): Redis {
  const redis = new Redis(url, {
    ...(prefix ? { keyPrefix: KEY_PREFIX } : {}),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  // A dropped connection must not crash the process; readiness reports it.
  redis.on('error', () => {});
  return redis;
}

/**
 * A connection for one BullMQ Queue or Worker; each gets its own, so one stalled consumer never stalls
 * another. Workers need `maxRetriesPerRequest: null` (their blocking commands stay open for minutes).
 * Producers sit on HTTP paths, so they fail fast while Redis is away instead of hanging the request.
 */
export function createBullConnection(url: string, role: 'producer' | 'worker' = 'worker'): Redis {
  const redis =
    role === 'worker'
      ? new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false })
      : new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2_000 });
  redis.on('error', () => {});
  return redis;
}
