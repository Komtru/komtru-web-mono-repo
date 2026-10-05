# T-023 Redis, BullMQ and Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Shared Redis connections under the `komtru:` prefix, a BullMQ queue factory with backoff, attempt caps and a dead-letter queue, and a cron scheduler (Africa/Lagos) that only the worker runs.

**Architecture:** `platform/redis` builds connections: the app client uses ioredis `keyPrefix: 'komtru:'`; BullMQ connections use `maxRetriesPerRequest: null` and BullMQ's own `prefix: 'komtru:bull'` (BullMQ rejects ioredis `keyPrefix`). `platform/queue` exposes `createQueueFactory()`: `producer(name)` everywhere, `consume(definition)` only in the worker. A job that exhausts its attempts is copied to `<name>.dead`, counted by a metric, logged, and passed to an `onDeadLetter` hook (the ops-event bus arrives in T-024). `platform/scheduler` lifts the old registry as a per-process instance and the old queue as `startScheduler()`. Modules declare `queues` and `schedules`; `start(ctx)` receives `{ queues }` so a module can enqueue.

**Tech Stack:** bullmq 6.3.11, cron-parser 5.10.1 (BullMQ's own parser), ioredis 5.11.1, Redis 7.

**Spec:** design §4 (BullMQ for all external I/O, stateless processes), ticket T-023 in `docs/tickets/02-backend-platform.md`; cannibalized from `kumtru/backend-apis/src/modules/scheduler/{domain/registry.ts,infrastructure/queue.ts}` (T-001).

## Global Constraints

- Key prefix `komtru:` on every key the platform writes.
- Cron evaluated in `Africa/Lagos` (`SCHEDULER_TIMEZONE`, default `Africa/Lagos`).
- Job names `module.job-name`; the registry throws at boot on a bad name, bad cron or duplicate.
- Only the worker process starts consumers and schedulers; the API only produces.
- Defaults: queue jobs `attempts: 5`, exponential backoff from 2 s; scheduler occurrences `attempts: 1` (the next occurrence is the retry).

## Review Focus

1. A job failing on its last attempt lands in the dead-letter queue exactly once, not on earlier attempts.
2. Two worker instances starting the scheduler converge on one schedule per job (scheduler id = job name).
3. A schedule renamed in code is pruned at worker start; an occurrence for a pruned job is skipped, not failed.
4. Shutdown closes workers before their connections, so an in-flight job finishes.
5. Jobs enqueued from two API instances are each processed exactly once by one worker.

---

### Task 1: Redis connections and queue factory with dead-letter queue

**Files:** create `src/platform/redis/connections.ts`, `src/platform/queue/factory.ts`, `src/platform/queue/metrics.ts`; modify `src/config/env.ts` (`SCHEDULER_TIMEZONE`); test `test/platform/queue.int.test.ts`.

- `createRedis(url): Redis` (keyPrefix `komtru:`), `createBullConnection(url): Redis`, `BULL_PREFIX = 'komtru:bull'`.
- `createQueueFactory({ redisUrl, logger, onDeadLetter? }): QueueFactory` with `producer<T>(name): Queue<T>`, `consume<T>(def: QueueDefinition<T>): Worker<T>`, `close(): Promise<void>` (workers, then queues, then connections). `QueueDefinition<T> = { name, process(data: T, job): Promise<unknown>, attempts?, backoffMs?, concurrency? }`.
- `deadLetterCounter` in `metrics.ts`: `{ increment(queue), snapshot(): Record<string, number> }` (in-process; Prometheus exporter is a later ticket).
- [ ] Tests (infra-gated): app client writes `komtru:`-prefixed keys; a job succeeds once; a job that always throws with `attempts: 3, backoffMs: 10` runs 3 times, lands in `<name>.dead` once with the error message, increments the metric once, calls `onDeadLetter` once; a job that fails then succeeds is not dead-lettered; queue keys start with `komtru:bull:`.
- [ ] RED → implement → GREEN → commit `feat(backend-api): redis connections and queue factory with dead-letter queue`.

### Task 2: Scheduler registry and runner

**Files:** create `src/platform/scheduler/registry.ts` (lifted; per-instance `createScheduleRegistry()`), `src/platform/scheduler/scheduler.ts` (lifted `startScheduler`/`stop`, `pruneOrphanedSchedules`, `didSomething`); tests `test/platform/scheduler-registry.test.ts`, `test/platform/scheduler.int.test.ts`.

- Registry: `register(job)`, `get(name)`, `list()`; validation as the old file.
- `startScheduler({ registry, redisUrl, timezone, logger, queueName? }): Promise<{ stop(): Promise<void>; pruned: string[] }>`.
- [ ] Unit tests: valid/invalid names (`trades.auto-complete` ok; `trades`, `Trades.x`, `trades.-x`, `trades.a--b` rejected), invalid cron rejected, duplicate rejected.
- [ ] Int tests: schedulers upserted with `tz: 'Africa/Lagos'` and a `0 2 * * *` job's next run is 01:00 UTC; a stale scheduler id is pruned at start; starting twice yields one scheduler per job; an occurrence for an unregistered job completes with `{ skipped: true }`; the handler receives the scheduled instant.
- [ ] RED → implement → GREEN → commit `feat(backend-api): cron scheduler in africa/lagos`.

### Task 3: Wire into modules and processes; statelessness test

**Files:** modify `src/platform/module.ts` (`queues?: QueueDefinition<any>[]`, `schedules?: ScheduledJob[]`, `start?(ctx: ModuleContext)`), `src/server.ts` (producer-only factory in ctx; closer), `src/worker-process.ts` (consume every module queue, register every schedule, start the scheduler; closers in order scheduler → queues → modules → clients); test `test/integration/statelessness.int.test.ts`.

- [ ] Int test: two `startApi` instances and one `startWorker` share one Redis; a module route enqueues; 20 jobs enqueued across both APIs are each processed exactly once; the API process never starts a consumer (no worker registered for the queue when only APIs run).
- [ ] RED → implement → GREEN → commit `feat(backend-api): queues and schedules in the module lifecycle`.
