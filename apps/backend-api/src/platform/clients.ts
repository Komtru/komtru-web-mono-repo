// Connections to Postgres (through PgBouncer) and Redis, shared by the whole process.
// T-021 and T-023 build the database and queue layers on these; this file only creates and closes them.
import { Redis } from 'ioredis';
import pg from 'pg';
import type { AppConfig } from '../config/env.js';
import type { HealthCheck } from './health.js';

export interface Clients {
  pool: pg.Pool;
  redis: Redis;
  close(): Promise<void>;
}

export function createClients(config: AppConfig): Clients {
  const pool = new pg.Pool({
    connectionString: config.postgres.url,
    max: config.postgres.poolMax,
    ssl: config.postgres.ssl ? { rejectUnauthorized: true } : false,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
  });
  // An idle client erroring (e.g. the server restarting) must not crash the process.
  pool.on('error', () => {});

  const redis = new Redis(config.redis.url, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  redis.on('error', () => {});

  return {
    pool,
    redis,
    async close() {
      await Promise.allSettled([pool.end(), redis.quit()]);
    },
  };
}

export const postgresCheck = (pool: pg.Pool): HealthCheck => ({
  name: 'postgres',
  async check() {
    await pool.query('SELECT 1');
  },
});

/**
 * Resolves once the client is connected. With the offline queue disabled, a command sent while still
 * connecting fails outright, so readiness would flap right after boot. The caller's timeout bounds
 * the wait (runChecks reports `timeout`).
 */
const whenReady = (redis: Redis): Promise<void> =>
  redis.status === 'ready'
    ? Promise.resolve()
    : new Promise((resolve, reject) => {
        const onReady = () => {
          redis.off('end', onEnd);
          resolve();
        };
        const onEnd = () => {
          redis.off('ready', onReady);
          reject(new Error('redis connection ended'));
        };
        redis.once('ready', onReady);
        redis.once('end', onEnd);
      });

export const redisCheck = (redis: Redis): HealthCheck => ({
  name: 'redis',
  async check() {
    await whenReady(redis);
    if ((await redis.ping()) !== 'PONG') throw new Error('unexpected PING reply');
  },
});
