# T-029 Isolate the Integration Suite's Shared Redis and Queues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Two test files running at the same moment cannot see each other's Redis keys — not their BullMQ queues, not their rate-limit counters, not their idempotency leases — so the full infra suite passes 20 consecutive runs instead of failing roughly one in three.

**Architecture:** The namespace a process writes under stops being a module constant and becomes configuration, exactly like `POSTGRES_URL` already is. `AppConfig.redis` gains `keyPrefix` and `queuePrefix`, defaulted to today's `komtru:` and `komtru:bull`, and the three places that build a client or a queue factory read them from config instead of importing the constant. The test harness then does for Redis precisely what `workerDatabase()` already does for Postgres: derives a per-worker suffix from `VITEST_POOL_ID` and sets the two variables, so isolation comes from the same mechanism in both stores rather than from two unrelated ones.

**Tech Stack:** ioredis 5.11 (`keyPrefix` on the client), BullMQ (`prefix` on Queue and Worker — it refuses ioredis's `keyPrefix` and takes its own), zod 4 for the config schema, Vitest 5 with the per-worker template-clone harness.

**Spec:** Ticket T-029 in `docs/tickets/02-backend-platform.md`. Background on what the shared namespace broke: the T-031 status note in `docs/tickets/03-identity.md`, and design §4.3 (the relay) in `docs/superpowers/specs/2026-10-05-komtru-platform-design.md`.

## Global Constraints

- **No drizzle migration.** This ticket touches no schema.
- Production behaviour must not change: with neither variable set, every key lands exactly where it lands today (`komtru:…`, `komtru:bull:<queue>:…`). A test proves the defaults.
- Exact dependency versions, no `^`. TypeScript strict, ESM with `.js` extensions on relative imports, zod 4. Comments are sparse and explain _why_.
- `BULL_PREFIX` and `KEY_PREFIX` stay exported from `src/platform/redis/connections.ts` as the defaults; nothing else may import them to build a client.
- Infra runs: `KOMTRU_INFRA_TESTS=1 KOMTRU_TEST_DB_PREFIX=komtru_t029 KOMTRU_TEST_REDIS_URL=redis://localhost:56379/4`.

## Review Focus

1. **A prefix that is set but empty** must not silently collapse every key into the global namespace — the config schema rejects an empty string rather than treating it as "unset" (Task 1).
2. **BullMQ's prefix and ioredis's `keyPrefix` must never both apply to the same connection.** BullMQ computes its own key names; a client-level prefix underneath it produces `komtru:komtru:bull:…` and a queue nobody can find. `createBullConnection` must stay unprefixed no matter what config says (Task 2).
3. **A queue name is half of a job's identity; the dead-letter queue is the other half.** `deadLetter` enqueues to `<name>.dead` through its own `producer()` call, so it must pick up the same prefix as the queue it came from, or a dead-lettered job lands somewhere nothing drains (Task 2).
4. **A test that builds a client directly** (`createTestRedis`, and any file calling `createRedis(testRedisUrl())`) is the easiest thing to forget, and forgetting it reintroduces exactly the bug — the namespace helper must be the only way a test gets a Redis client, proven by a scanning test like `test/support/shared-redis.test.ts` (Task 3).
5. **Isolation must not hide a real ordering bug.** The relay's watermark and the notify retry path are timing-sensitive on their own merits; after isolation the three named flakes must pass because the race is gone, not because the test got quieter. Each one keeps its `eventually` diagnostic so a future failure still reports state (Task 4).

---

### Task 1: Configuration carries the namespace

**Files:**

- Modify: `apps/backend-api/src/config/env.ts`
- Modify: `apps/backend-api/.env.example`
- Test: `apps/backend-api/test/config/env.test.ts`

**Interfaces:**

- Produces, on `AppConfig.redis`: `keyPrefix: string` (env `REDIS_KEY_PREFIX`, default `KEY_PREFIX`) and `queuePrefix: string` (env `REDIS_QUEUE_PREFIX`, default `BULL_PREFIX`).

- [ ] **Step 1: Write the failing tests** in `test/config/env.test.ts`, inside the existing describe:

```ts
it('defaults the redis namespace to the shared production one', () => {
  const { redis } = loadConfig(base);
  expect(redis.keyPrefix).toBe('komtru:');
  expect(redis.queuePrefix).toBe('komtru:bull');
});

it('takes a namespace per run, so two runs cannot see each other', () => {
  const { redis } = loadConfig({
    ...base,
    REDIS_KEY_PREFIX: 'komtru_t3:',
    REDIS_QUEUE_PREFIX: 'komtru_t3:bull',
  });
  expect(redis.keyPrefix).toBe('komtru_t3:');
  expect(redis.queuePrefix).toBe('komtru_t3:bull');
});

it('refuses an empty namespace rather than silently sharing one', () => {
  expect(() => loadConfig({ ...base, REDIS_KEY_PREFIX: '' })).toThrow(/REDIS_KEY_PREFIX/);
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run test/config/env.test.ts` from `apps/backend-api` — expect FAIL.
- [ ] **Step 3: Declare both variables** in `VARIABLES` as `z.string().min(1)`, `required: false`, and build the two keys into the `redis` block of `loadConfig`'s return, importing `KEY_PREFIX` and `BULL_PREFIX` as the defaults. Comment why an empty string is rejected: it is indistinguishable from "unset" at the call site but means the opposite.
- [ ] **Step 4: Run the same command** — expect PASS.
- [ ] **Step 5: Document both** in `.env.example` next to `REDIS_URL`, noting they exist for test isolation and that production leaves them unset.
- [ ] **Step 6: Commit** `feat(platform): make the redis namespace configuration rather than a constant`

---

### Task 2: The clients and the queue factory read it

**Files:**

- Modify: `apps/backend-api/src/platform/redis/connections.ts`
- Modify: `apps/backend-api/src/platform/queue/factory.ts`
- Modify: `apps/backend-api/src/platform/clients.ts`
- Modify: `apps/backend-api/src/server.ts`, `apps/backend-api/src/worker-process.ts`
- Test: `apps/backend-api/test/platform/clients.test.ts`, `apps/backend-api/test/platform/queue.int.test.ts`

**Interfaces:**

- Consumes: `config.redis.keyPrefix`, `config.redis.queuePrefix` (Task 1).
- Produces: `createRedis(url, { keyPrefix?: string | false })` — `false` means no prefix, replacing today's `{ prefix: boolean }`; `createQueueFactory({ redisUrl, logger, prefix?, onDeadLetter? })`.
- `createBullConnection` is unchanged and stays unprefixed.

- [ ] **Step 1: Write the failing tests.** In `test/platform/clients.test.ts`, assert `createRedis(url, { keyPrefix: 'x:' }).options.keyPrefix === 'x:'` and that the default is `komtru:`. In `test/platform/queue.int.test.ts`, add a test that a factory built with `prefix: 'komtru_a:bull'` and one with `prefix: 'komtru_b:bull'` enqueue to the same queue name without either worker seeing the other's job — this is the bug, so it is the test that proves the fix.
- [ ] **Step 2: Run** `pnpm exec vitest run test/platform/clients.test.ts` and the queue test — expect FAIL.
- [ ] **Step 3: Widen `createRedis`'s option** from `{ prefix?: boolean }` to `{ keyPrefix?: string | false }`, defaulting to `KEY_PREFIX`. Update the one existing `{ prefix: false }` caller.
- [ ] **Step 4: Add `prefix` to `QueueFactoryOptions`,** defaulted to `BULL_PREFIX`, and use it for both `new Queue` and `new Worker`. Check `deadLetter`: it must reach the prefixed `<name>.dead` queue through the same `producer()` path (Review Focus 3).
- [ ] **Step 5: Pass config through** at the three construction sites — `clients.ts` (`createRedis(config.redis.url, { keyPrefix: config.redis.keyPrefix })`), `server.ts` and `worker-process.ts` (`prefix: config.redis.queuePrefix`).
- [ ] **Step 6: Run** both test files — expect PASS. Then `pnpm exec tsc -p tsconfig.json --noEmit` and `pnpm exec eslint .`.
- [ ] **Step 7: Commit** `feat(platform): thread the redis namespace through the clients and the queue factory`

---

### Task 3: One namespace per Vitest worker, and only one way to get a client

**Files:**

- Modify: `apps/backend-api/test/support/db-urls.ts`
- Modify: `apps/backend-api/test/support/shared-redis.test.ts`
- Modify: every test file that builds a Redis client or an app env — find them with `grep -rln "createRedis\|testRedisUrl" apps/backend-api/test`
- Test: `apps/backend-api/test/support/shared-redis.test.ts`

**Interfaces:**

- Produces, from `test/support/db-urls.ts`:
  - `testKeyPrefix(): string` — `komtru_<pool id>:`, mirroring `workerDatabase()`
  - `testQueuePrefix(): string` — `komtru_<pool id>:bull`
  - `testRedisEnv(): { REDIS_KEY_PREFIX: string; REDIS_QUEUE_PREFIX: string }` — spread into any env a test passes to `startApi`/`startWorker`/`loadConfig`
  - `testRedis(): Redis` — the only sanctioned way for a test to build a client

- [ ] **Step 1: Write the failing test.** Extend `test/support/shared-redis.test.ts` with a second case: no test file may call `createRedis(` directly — they must go through `testRedis()`. Keep the existing wholesale-flush case green.
- [ ] **Step 2: Run** `pnpm exec vitest run test/support/shared-redis.test.ts` — expect FAIL, listing the files that build their own client.
- [ ] **Step 3: Add the four helpers** to `test/support/db-urls.ts`, deriving the id from `process.env.VITEST_POOL_ID ?? '1'` exactly as `workerDatabase()` does. Comment why the two stores now share one mechanism.
- [ ] **Step 4: Convert every offender** the failing test named: replace direct `createRedis` calls with `testRedis()`, and spread `testRedisEnv()` into every env object a test hands to `startApi`, `startWorker` or `loadConfig`. `test/modules/identity/support.ts`'s `createTestRedis` becomes a thin re-export of `testRedis`.
- [ ] **Step 5: Run** the guard test — expect PASS. Then the whole unit suite: `pnpm exec vitest run`.
- [ ] **Step 6: Commit** `test(platform): give every vitest worker its own redis namespace`

---

### Task 4: Prove it, and keep the diagnostic

**Files:**

- Modify: `apps/backend-api/test/integration/notifications.int.test.ts`, `apps/backend-api/test/platform/http/idempotency.int.test.ts` (only if a residual failure is diagnosed to them)
- Modify: `docs/tickets/02-backend-platform.md`

**Interfaces:** none — this task spends its effort on evidence.

- [ ] **Step 1: Run the full infra suite once** with the T-029 variables and confirm it passes: `KOMTRU_INFRA_TESTS=1 KOMTRU_TEST_DB_PREFIX=komtru_t029 KOMTRU_TEST_REDIS_URL=redis://localhost:56379/4 pnpm exec vitest run`.
- [ ] **Step 2: Run it 20 consecutive times** in a loop, recording pass/fail for each. Expected: 20 passes. This is the ticket's acceptance criterion and the only thing that closes it.
- [ ] **Step 3: If any run fails,** do not raise the timeout. Use `superpowers:systematic-debugging`: the `eventually` describe callback already reports queue and row state at the moment of giving up — read what it says, and if it names a cause outside this ticket's scope, record it rather than papering over it.
- [ ] **Step 4: Confirm the three named flakes** each ran and passed across the 20, by name, not by the aggregate count.
- [ ] **Step 5: Write the ticket note** under T-029 in `docs/tickets/02-backend-platform.md`: `- **Status:** Done (2026-10-06). Plan: …`, what the shared namespace actually broke, what each of the three flakes turned out to be, and a `- **Deferred:**` line.
- [ ] **Step 6: Commit** `test(platform): prove the infra suite is stable across twenty runs`
