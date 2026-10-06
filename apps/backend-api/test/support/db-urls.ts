// Where integration tests find Postgres and Redis. Defaults match docker-compose.yml; CI overrides
// them, and so does a second agent working in another worktree against the same containers: set
// KOMTRU_TEST_DB_PREFIX and KOMTRU_TEST_REDIS_URL (a distinct Redis logical database) and two runs
// cannot see each other's template, worker databases or queue keys.
export const infraEnabled = process.env.KOMTRU_INFRA_TESTS === '1';

const directBase = process.env.KOMTRU_TEST_DIRECT_URL ?? 'postgresql://komtru:komtru@localhost:55432';
const pooledBase = process.env.KOMTRU_TEST_POOLED_URL ?? 'postgresql://komtru_app:komtru_app@localhost:56432';

/** Every database this harness creates starts with this, so one run can be told from another. */
export const TEST_DB_PREFIX = process.env.KOMTRU_TEST_DB_PREFIX ?? 'komtru_test';
export const TEMPLATE_DATABASE = `${TEST_DB_PREFIX}_template`;

/** Redis for the tests that need a real one. A logical database keeps concurrent runs apart. */
export const testRedisUrl = (): string => process.env.KOMTRU_TEST_REDIS_URL ?? 'redis://localhost:56379';

// A logical database separates two *runs*; it does nothing for the files of one run, which Vitest
// executes in parallel against the same database. So Redis gets what Postgres already has: one
// namespace per worker, off the same `VITEST_POOL_ID`, so `workerDatabase()` and these cannot drift
// apart. Without this, one file's worker drains another file's queue and executes the job against
// the wrong database.
const workerId = (): string => process.env.VITEST_POOL_ID ?? '1';

/** ioredis `keyPrefix` for this worker: rate limits, idempotency leases, caches. */
export const testKeyPrefix = (): string => `${TEST_DB_PREFIX}_${workerId()}:`;
/** BullMQ's own prefix for this worker. BullMQ refuses ioredis's `keyPrefix` and takes this. */
export const testQueuePrefix = (): string => `${TEST_DB_PREFIX}_${workerId()}:bull`;

/** Spread into any env a test hands to `startApi`, `startWorker` or `loadConfig`. */
export const testRedisEnv = (): { REDIS_KEY_PREFIX: string; REDIS_QUEUE_PREFIX: string } => ({
  REDIS_KEY_PREFIX: testKeyPrefix(),
  REDIS_QUEUE_PREFIX: testQueuePrefix(),
});
/** Local throwaway password the harness gives komtru_app (it matches KOMTRU_TEST_POOLED_URL). */
export const TEST_APP_PASSWORD = decodeURIComponent(new URL(pooledBase).password);

/** Owner connection straight to Postgres. */
export const directUrl = (database: string) => `${directBase}/${database}`;
/** komtru_app through PgBouncer, as the app connects. */
export const pooledUrl = (database: string) => `${pooledBase}/${database}`;
export const pooledPort = () => Number(new URL(pooledBase).port);
