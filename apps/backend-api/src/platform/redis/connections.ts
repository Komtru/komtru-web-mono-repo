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
 * A connection for one BullMQ Queue or Worker. BullMQ requires `maxRetriesPerRequest: null` because
 * its blocking commands stay open for minutes; each Queue and Worker gets its own, so one stalled
 * consumer never stalls another.
 */
export function createBullConnection(url: string): Redis {
  const redis = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
  redis.on('error', () => {});
  return redis;
}
