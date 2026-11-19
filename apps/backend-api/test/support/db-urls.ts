// Where integration tests find Postgres and Redis. Defaults match docker-compose.yml; CI overrides
// them, and so does a second agent working in another worktree against the same containers: set
// KOMTRU_TEST_DB_PREFIX and KOMTRU_TEST_REDIS_URL (a distinct Redis logical database) and two runs
// cannot see each other's template, worker databases or queue keys.
export const infraEnabled = process.env.KOMTRU_INFRA_TESTS === '1';

const directBase = process.env.KOMTRU_TEST_DIRECT_URL ?? 'postgresql://komtru:komtru@localhost:55432';
const pooledBase = process.env.KOMTRU_TEST_POOLED_URL ?? 'postgresql://komtru_app:komtru_app@localhost:56432';

/** Every database this harness creates starts with this, so one run can be told from another. */
export const TEST_DB_PREFIX = process.env.KOMTRU_TEST_DB_PREFIX ?? 'komtru_test';

/** Redis for the tests that need a real one. A logical database keeps concurrent runs apart. */
export const testRedisUrl = (): string => process.env.KOMTRU_TEST_REDIS_URL ?? 'redis://localhost:56379';

// A logical database separates two *runs*; it does nothing for the files of one run, which Vitest
// executes in parallel against the same database. So Redis gets what Postgres already has: one
// namespace per worker, off the same `VITEST_POOL_ID`, so `workerDatabase()` and these cannot drift
// apart. Without this, one file's worker drains another file's queue and executes the job against
// the wrong database.
const workerId = (): string => process.env.VITEST_POOL_ID ?? '1';

/**
 * Set once per run by the global setup, before any worker forks. Without it two runs share a
 * namespace, and the second inherits the first's queues — which matters because BullMQ keeps a
 * failed job for 30 days and silently ignores re-adding its id, so a job that cannot run again is
 * also a job that cannot be replaced. Falls back to a constant so a worker started outside the
 * harness still produces a stable name rather than a random one per import.
 */
const runId = (): string => process.env.KOMTRU_TEST_RUN_ID ?? 'norun';

/** The run's name stem for every test resource (databases here, Redis namespaces below). */
const runScope = (): string => `${TEST_DB_PREFIX}_${runId()}`;

const namespace = (): string => `${runScope()}_${workerId()}`;

/** The migrated template this run clones from. Run-scoped: a second run must not drop it. */
export const templateDatabaseName = (): string => `${runScope()}_template`;
/** The database this test worker owns. Run-scoped for the same reason as the template. */
export const workerDatabaseName = (): string => namespace();

/** ioredis `keyPrefix` for this worker: rate limits, idempotency leases, caches. */
export const testKeyPrefix = (): string => `${namespace()}:`;
/** BullMQ's own prefix for this worker. BullMQ refuses ioredis's `keyPrefix` and takes this. */
export const testQueuePrefix = (): string => `${namespace()}:bull`;

/**
 * Deletes every key this run created, and nothing else.
 *
 * The match is anchored on `<prefix>_<runId>_`, so a run cannot touch a concurrent run's keyspace
 * or the application's own `komtru:` keys. SCAN rather than KEYS because this runs against the same
 * instance a developer may have real data on, and UNLINK rather than DEL so the reclaim happens off
 * the command thread.
 */
export const releaseRunKeyspace = async (): Promise<number> => {
  const { Redis } = await import('ioredis');
  const redis = new Redis(testRedisUrl(), { maxRetriesPerRequest: 1 });
  let removed = 0;
  try {
    const match = `${runScope()}_*`;
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', match, 'COUNT', 500);
      cursor = next;
      if (keys.length) removed += await redis.unlink(...keys);
    } while (cursor !== '0');
  } catch {
    // Teardown must never fail a run that passed: a Redis that went away takes its keys with it.
  } finally {
    await redis.quit().catch(() => redis.disconnect());
  }
  return removed;
};

/**
 * Spread into any env a test hands to `startApi` or `startWorker`.
 *
 * The pool cap is the point: the app defaults to 10 connections, a single integration test starts
 * an API *and* a worker, and Vitest runs 200 files at once against a PgBouncer allowing 200 client
 * connections in total. The suite exhausts them long before any test is at fault, and the symptom
 * is `Connection terminated due to connection timeout` in whichever file lost the race. Three is
 * ample for a test and leaves the ceiling far away.
 */
export const testProcessEnv = (): Record<string, string> => ({
  ...testRedisEnv(),
  POSTGRES_POOL_MAX: '3',
});

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
