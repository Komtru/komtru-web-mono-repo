# Testing conventions

Test-first throughout. Tests are part of the ticket, not a pass after it.

## A failure that only appears in the full suite

It is almost always **cross-file interference, not slowness.** Before theorising about timeouts:

1. Re-run the file on its own. If it passes alone, you are looking at interference or at load
   from another session — check `uptime` and see
   [parallel work](parallel-work.md).
2. Make the assertion report state rather than just failing. `test/support/eventually.ts` takes
   a `describe` callback; in T-031 that named the cause immediately where a bare timeout had
   hidden it for several runs.

The known sources of interference:

- **One Redis keyspace.** Vitest runs test files in parallel against a single Redis logical
  database and `BULL_PREFIX` is one constant, so the whole infra suite shares a keyspace. A test
  that flushes that database wholesale deletes another file's in-flight BullMQ job, and the
  symptom surfaces in the innocent file — in T-031 as a notification stuck at `QUEUED` with an
  empty queue and a provider that was never called. `test/support/shared-redis.test.ts` now
  fails on any wholesale flush.
- **`pg_snapshot_xmin()` is cluster-wide**, so anything built on it is held back by a
  transaction in _any_ database on the instance, including another worker's. Bound such waits
  and make the test tolerate them.
- **Contention, genuinely.** A few suites — argon2 logins, repo-wide file scans — time out under
  8-worker load and pass alone. The repo's fix is an explicit per-test budget, not a retry.

## Before you create a test file, read what is there

`grep` for a route factory's name can miss a suite that mounts the routes differently. An F-081
commit overwrote 15 live T-039 tests this way.

## Backend integration tests

They are `apps/backend-api/test/modules/**/*.int.test.ts`, gated on `infraEnabled`.
`pnpm test:int` **does not run them** — it covers only `test/integration` and `test/db`. Run:

```bash
KOMTRU_INFRA_TESTS=1 pnpm --filter @komtru/backend-api exec vitest run <path>
```

## Stale builds masquerading as test failures

`@komtru/api-client` and `@komtru/shared-types` are consumed from their built `dist`. A field
you just added reading as `undefined` means the package wasn't rebuilt, not that the test is
wrong. See [packages/CLAUDE.md](../../packages/CLAUDE.md).
