// Redis connections. Every key the platform writes lives under `komtru:`, so the shared Redis can
// host other tenants (and the old backend) without collisions.
import { Redis } from 'ioredis';

export const KEY_PREFIX = 'komtru:';
/** BullMQ keys: `komtru:bull:<queue>:…`. BullMQ refuses ioredis keyPrefix and takes its own. */
export const BULL_PREFIX = 'komtru:bull';

/**
 * The app's client: commands fail fast rather than queueing while Redis is away.
 *
 * `keyPrefix` is a parameter rather than the constant because the integration suite runs its files
 * in parallel against one Redis database; a namespace per worker is what stops one file's keys from
 * being another's. `false` means no prefix at all, for a test that wants to read raw keys.
 */
export function createRedis(
  url: string,
  { keyPrefix = KEY_PREFIX }: { keyPrefix?: string | false } = {},
): Redis {
  const redis = new Redis(url, {
    ...(keyPrefix === false ? {} : { keyPrefix }),
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
