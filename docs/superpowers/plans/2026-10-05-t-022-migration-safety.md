# T-022 Migration-safety Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tools/migration-safety`, a check that fails a build on drizzle journal/snapshot drift, on a migration edited after it was applied, on a dangerous SQL statement, on a chain that does not apply forward from `main`'s schema, and on a schema-level invariant (partial unique index, check constraint, trigger) added without being written down — wired into `backend-api`'s workflow ahead of `deploy`.

**Architecture:** Plain `.mjs` modules with hand-written `.d.mts` types under `tools/migration-safety/`, the shape `scripts/env/*.mjs` already uses, driven by one CLI (`pnpm migration:safety`) and tested from `scripts/test/` through `pnpm test:repo`. Static checks (journal, lock, lint) need no database and run in every repo build; the three that need one (replay from empty, forward from `main`, introspection) run in the new `migration-safety` CI job against a throwaway Postgres and are gated locally behind `KOMTRU_INFRA_TESTS=1`.

**Tech Stack:** Node 22 ESM, `pg` 8.23.1, Vitest 5, Postgres 16, drizzle-kit 0.31.11 journal/snapshot format v7.

**Spec:** `docs/superpowers/specs/2026-10-05-komtru-platform-design.md` §10 ("`backend-api` has a required `migration-safety` job before deploy: drizzle-kit snapshot/journal consistency, a clean apply on an empty database, a forward apply from the previous `main` schema, a dangerous-operation lint … and an introspection test asserting every documented partial unique index and append-only trigger exists") and ticket T-022 in `docs/tickets/02-backend-platform.md`.

## What "unsafe" means here, and why these checks

Drizzle's Postgres migrator (`drizzle-orm/pg-core/dialect.cjs`, `PgDialect.migrate`) does three things that decide this tool's design:

1. It reads `meta/_journal.json`, selects `created_at` from the **one** most recently applied row, and applies every journal entry whose `when` is **greater** than it. A migration whose `when` is older than one already applied is skipped **silently, forever**. Ten agents generating migrations in parallel worktrees is exactly how that happens: whoever merges second may carry the older timestamp. A replay from empty cannot see this; a forward apply from `main` can, and a strictly-increasing `when` is a static check that costs nothing.
2. It wraps the whole run — every pending migration, every statement — in **one transaction**. So `CREATE INDEX CONCURRENTLY` is not merely discouraged here, it is impossible (Postgres refuses it inside a transaction block), and any lock a migration takes is held until the last migration in the run commits. A backfill in a migration therefore blocks writes for the length of the entire deploy, not the length of the statement.
3. It hashes each file (sha256 of the whole text) but **never compares that hash to the applied row**. Editing a migration that has already run anywhere changes nothing in that database and leaves it permanently different from a fresh one. The journal and the file silently disagree. A committed lock of `tag → when + sha256` turns that into a diff a reviewer has to approve.

The repo already proves a replay from empty works: the backend's Vitest `globalSetup` drops its template database and applies all 16 migrations on every infra run. So replay-from-empty here exists to produce the two schemas the _other_ checks compare, not as the check's value.

The dangerous-operation lint is about a database that is already live: a statement that is free on an empty table (and therefore green in every test this repo has) is an outage on a populated one. Each rule names the lock it takes or the data it destroys. Because `CONCURRENTLY` is unavailable, a finding's remedy is either "this table is small, say so" (a waiver) or "do this outside the migrator" — never "add CONCURRENTLY".

## Global Constraints

- Node 22 ESM, `.js`/`.mjs` extensions on relative imports, plain exported functions, no classes. Exact dependency versions, no `^`. Comments sparse and about _why_.
- `tools/` is not a pnpm workspace (`pnpm-workspace.yaml` is `apps/*` + `packages/*`), so these are `.mjs` with hand-written `.d.mts`, like `scripts/env/local-infra.mjs`. No new dependency: `pg` 8.23.1 is already a root devDependency.
- Prettier: printWidth 110, single quotes, trailing commas, semicolons. `pnpm format:check` covers `tools/`.
- Every database this tool creates is named `${KOMTRU_MIGRATION_SAFETY_DB_PREFIX ?? 'komtru_migration_safety'}_<n>` and dropped in a `finally`. It never touches a database it did not create. Local runs in this worktree set the prefix to `komtru_t022_safety`.
- No new migration: the next migration numbers belong to other tickets. Migrations 0007, 0013 and 0015 gain **comment-only** waiver lines (safe: drizzle never re-reads an applied migration's hash, and nothing is deployed).
- Local infra test namespace: `KOMTRU_INFRA_TESTS=1 KOMTRU_TEST_DB_PREFIX=komtru_t022 KOMTRU_TEST_REDIS_URL=redis://localhost:56379/1`.

## Review Focus

1. A migration file that is valid UTF-8 but not valid SQL for the splitter — a `$tag$`-quoted body, a `;` inside a string literal, a `--` inside a string literal. The lint must not mis-split and must not report a rule from inside a `CREATE FUNCTION` body (that SQL runs later, under its own locks), while a `DO $$ … $$` block does run now and must be scanned. Covered in Task 2.
2. A waiver for a rule that does not exist, or with no reason: a typo in the rule id must fail loudly, not silently waive nothing (and worse, look waived). Covered in Task 2.
3. The forward check when there is nothing to compare: a shallow CI clone, a branch whose base ref is missing, a `main` with an identical drizzle folder. Each must produce a stated skip or a stated no-op, never a silent pass. Covered in Task 4.
4. The tool crashing partway (a migration that fails to apply) must still drop its scratch databases, or the next run on a shared Postgres collides. Covered in Task 3.
5. An invariants file written against a different Postgres major: `pg_get_indexdef` output changes between majors, so a mismatch would look like drift. The file records the major it was captured on and the check refuses to compare across majors. Covered in Task 3.

---

### Task 1: Load the migration folder; journal, snapshot and lock checks

**Files:**

- Create: `tools/migration-safety/migrations.mjs`, `tools/migration-safety/migrations.d.mts`
- Create: `tools/migration-safety/migrations.lock.json`
- Create: `scripts/test/migration-safety.test.ts`
- Create: `scripts/test/fixtures/migration-safety/{missing-sql,orphan-sql,broken-chain,out-of-order}/` — each a minimal drizzle folder (`meta/_journal.json`, `meta/NNNN_snapshot.json`, `NNNN_<tag>.sql`) with exactly one defect

**Interfaces:**

- Produces:
  - `MIGRATIONS_DIR: string` — absolute path to `apps/backend-api/drizzle`, resolved from `import.meta.url`
  - `loadMigrations(dir?: string): Migration[]` — `{ idx: number; tag: string; when: number; sql: string; sha256: string; snapshot: unknown }[]`, journal order. Throws only on unreadable/unparseable JSON.
  - `checkJournal(dir?: string): Finding[]`
  - `checkLock(dir?: string, lockPath?: string): Finding[]`
  - `writeLock(dir?: string, lockPath?: string): void`
  - `Finding = { check: string; rule: string; tag?: string; message: string }`
  - `LOCK_PATH: string`

`checkJournal` findings, one rule id each:

- `journal-complete` — a journal entry with no `<tag>.sql` or no `meta/<idx>_snapshot.json`; a `.sql` or snapshot file no entry names; `idx` not equal to its position; a tag whose numeric prefix is not its `idx`; a duplicate tag.
- `journal-order` — `when` not strictly greater than the previous entry's. Message must name both tags and say the later migration would be skipped by `PgDialect.migrate`.
- `snapshot-chain` — `snapshot.prevId !== previous.id`, a duplicate `id`, or a `dialect`/`version` that differs from the journal's.

`checkLock` compares `migrations.lock.json` (`{ tag, when, sha256 }[]`, journal order) with the folder: a tag in the lock whose `sha256` or `when` changed is rule `migration-edited`; a tag in the lock that is gone is `migration-removed`; a tag not in the lock is `migration-unlocked` (the remedy is `pnpm migration:safety --update-lock`, which belongs in the same commit as the migration). `sha256` is the sha256 of the whole file text, the same hash drizzle computes.

- [ ] **Step 1: Write the failing tests** in `scripts/test/migration-safety.test.ts`

```ts
describe('loadMigrations', () => {
  it('reads all 16 migrations in journal order with their snapshots', ...);   // tags 0000_platform_schema … 0015_identity_desc_indexes
});
describe('checkJournal', () => {
  it('passes on the repository's own drizzle folder', ...);                   // toEqual([])
  it('reports journal-complete for an entry with no sql file', ...);          // fixtures/missing-sql
  it('reports journal-complete for a sql file no entry names', ...);          // fixtures/orphan-sql
  it('reports snapshot-chain when prevId does not match the previous id', ...);// fixtures/broken-chain
  it('reports journal-order when a later entry has an older when', ...);      // fixtures/out-of-order, message names both tags
});
describe('checkLock', () => {
  it('passes on the committed lock', ...);
  it('reports migration-edited when a locked file changes', ...);             // copy the real folder to a tmp dir, append a comment
  it('reports migration-unlocked for a migration the lock does not list', ...);
});
```

- [ ] **Step 2: Run `pnpm test:repo -t 'migration-safety'`, watch it fail** (module not found)
- [ ] **Step 3: Implement `tools/migration-safety/migrations.mjs` and its `.d.mts`**
- [ ] **Step 4: Generate the lock** — `node tools/migration-safety/cli.mjs --update-lock` does not exist yet, so call `writeLock()` through `node --input-type=module -e`, then `pnpm exec prettier --write tools/migration-safety/migrations.lock.json`
- [ ] **Step 5: Run `pnpm test:repo -t 'migration-safety'`, all pass**
- [ ] **Step 6: Commit** `feat(migration-safety): check the drizzle journal, snapshot chain and migration lock`

### Task 2: Dangerous-operation lint

**Files:**

- Create: `tools/migration-safety/lint.mjs`, `tools/migration-safety/lint.d.mts`
- Create: `scripts/test/migration-safety-lint.test.ts`
- Create: `tools/migration-safety/waivers.json` (entries for `0007_identity_same_user_fks`, `0013_identity_four_eyes`, `0015_identity_desc_indexes`)

No migration file is touched: see the revision note below.

**Interfaces:**

- Consumes: `loadMigrations`, `Finding` from Task 1.
- Produces:
  - `RULES: Record<string, { summary: string }>` — the rule ids below; a waiver naming an id outside this map is itself a finding (`unknown-waiver`).
  - `splitStatements(sql: string): string[]` — splits on `--> statement-breakpoint` and on `;` outside single-quoted strings, dollar-quoted bodies (`$$`, `$tag$`), line comments and block comments.
  - `lintMigration(input: { tag: string; sql: string; existingTables: Set<string> }): Finding[]`
  - `checkLint(dir?: string): Finding[]` — walks the folder, accumulating `existingTables` from each file's `CREATE TABLE` statements and each snapshot's `tables` keys, so a rule only fires against a table that existed **before** the migration under test.

Rules (`rule` — what it costs on a live database):

| rule                          | fires on                                                                                             | why                                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `drop-object`                 | `DROP TABLE/SCHEMA/TYPE/VIEW/MATERIALIZED VIEW/SEQUENCE`, `ALTER TABLE … DROP COLUMN`, `TRUNCATE`    | destroys data; a column drop needs an expand/contract note saying when the last reader shipped                                                   |
| `index-lock`                  | `CREATE [UNIQUE] INDEX` on a pre-existing table                                                      | `ACCESS EXCLUSIVE`-free but `SHARE`: blocks every write to the table for the whole build, and (see above) until the entire migration run commits |
| `drop-index-lock`             | `DROP INDEX` on a pre-existing table                                                                 | takes `ACCESS EXCLUSIVE`, blocking reads as well                                                                                                 |
| `concurrently-in-transaction` | any `CONCURRENTLY`                                                                                   | the migrator runs every migration in one transaction; Postgres rejects it at deploy time                                                         |
| `not-null-no-default`         | `ALTER COLUMN … SET NOT NULL`, or `ADD COLUMN … NOT NULL` with no `DEFAULT`, on a pre-existing table | full table scan under `ACCESS EXCLUSIVE`, and `ADD COLUMN NOT NULL` without a default simply fails when rows exist                               |
| `type-change`                 | `ALTER COLUMN … [SET DATA] TYPE` on a pre-existing table                                             | rewrites the table under `ACCESS EXCLUSIVE`; narrowing also fails on existing data                                                               |
| `constraint-scan`             | `ADD CONSTRAINT … CHECK/FOREIGN KEY` without `NOT VALID` on a pre-existing table                     | validates every existing row under a strong lock; `NOT VALID` + a later `VALIDATE CONSTRAINT` does not                                           |
| `rename`                      | `ALTER TABLE/… RENAME`                                                                               | the old code is still running during a deploy and queries the old name                                                                           |
| `backfill`                    | top-level `UPDATE`/`DELETE FROM`/`INSERT INTO … SELECT` against a pre-existing table                 | holds its locks for the length of the whole migration run                                                                                        |

Waiver: an entry in `tools/migration-safety/waivers.json`, keyed by migration tag and rule id, whose value is the reason. The reason must be at least 20 characters; a shorter one, an unknown rule id, or a waiver nothing trips is itself a finding.

**Revised during Task 4.** The waiver started as a comment line in the migration, so the reason would sit next to the statement it excused. Running the finished tool killed that design: the three migrations that needed waivers were already on `main`, and adding a comment changed their hashes, so the forward check correctly reported all three as migrations the real migrator would never apply. A waiver mechanism that requires editing an applied migration contradicts the tool's own strongest rule, so waivers moved to a file of their own.

- [ ] **Step 1: Write the failing tests** in `scripts/test/migration-safety-lint.test.ts`, each rule proven to fire on a one-line SQL string and proven not to fire on its safe counterpart:

```ts
it.each([
  ['drop-object', 'ALTER TABLE "identity"."users" DROP COLUMN "bio";'],
  ['index-lock', 'CREATE INDEX "x" ON "identity"."users" USING btree ("locale");'],
  ['drop-index-lock', 'DROP INDEX "identity"."users_status_idx";'],
  ['concurrently-in-transaction', 'CREATE INDEX CONCURRENTLY "x" ON "identity"."users" ("locale");'],
  ['not-null-no-default', 'ALTER TABLE "identity"."users" ALTER COLUMN "locale" SET NOT NULL;'],
  ['type-change', 'ALTER TABLE "identity"."users" ALTER COLUMN "locale" TYPE varchar(8);'],
  ['constraint-scan', 'ALTER TABLE "identity"."users" ADD CONSTRAINT "c" CHECK (locale <> \'\');'],
  ['rename', 'ALTER TABLE "identity"."users" RENAME COLUMN "locale" TO "lang";'],
  ['backfill', "UPDATE \"identity\".\"users\" SET locale = 'en-NG';"],
])('fires %s', (rule, sql) => expect(rules(lintMigration({ tag: '0099_x', sql, existingTables }))).toContain(rule));

it('does not fire index-lock for an index on a table the same migration creates', ...);
it('does not fire constraint-scan for ADD CONSTRAINT ... NOT VALID', ...);
it('ignores a DROP TABLE inside a CREATE FUNCTION body but not inside a DO block', ...);
it('does not split on a semicolon inside a string literal or a $$ body', ...);
it('waives a rule named in a comment, with the reason', ...);
it('reports unknown-waiver for a rule id that does not exist', ...);
it('reports unknown-waiver when the reason is shorter than 20 characters', ...);
it('returns no findings for the 16 migrations in the repository', () => expect(checkLint()).toEqual([]));
```

- [ ] **Step 2: Run `pnpm test:repo -t 'migration-safety lint'`, watch it fail**
- [ ] **Step 3: Implement `tools/migration-safety/lint.mjs` and its `.d.mts`**
- [ ] **Step 4: Run it against the real folder and record what it flags** (expected: `0007` two `constraint-scan`, `0013` two `constraint-scan`, `0015` four `drop-index-lock` + four `index-lock`). Add one waiver line per rule per file, each stating the real reason — those tables are empty in every environment that exists because nothing is deployed yet, and for `0015` that `identity_audit_log` and `users` are the two tables that will be large, so a future index on either has to be built outside the migrator.
- [ ] **Step 5: Refresh the lock for the three edited files** (`--update-lock` arrives in Task 4; call `writeLock()` directly), then `pnpm test:repo -t 'migration-safety'` — all pass, including the clean-on-16 assertion
- [ ] **Step 6: Commit** `feat(migration-safety): lint migrations for statements that are unsafe on a live database`

### Task 3: Replay from empty, schema fingerprint, and the invariants list

**Files:**

- Create: `tools/migration-safety/database.mjs`, `tools/migration-safety/database.d.mts`
- Create: `tools/migration-safety/invariants.json`
- Create: `scripts/test/migration-safety-db.test.ts` (whole file inside `describe.runIf(process.env.KOMTRU_INFRA_TESTS === '1')`)

**Interfaces:**

- Consumes: `loadMigrations`, `Migration`, `Finding` from Task 1.
- Produces:
  - `scratchDatabase<T>(fn: (client: pg.Client) => Promise<T>, label: string): Promise<T>` — creates `<prefix>_<label>`, hands over a connected client, drops the database `WITH (FORCE)` in a `finally`. Reads `KOMTRU_TEST_DIRECT_URL` (default `postgresql://komtru:komtru@localhost:55432`) and `KOMTRU_MIGRATION_SAFETY_DB_PREFIX`.
  - `applyMigrations(client: pg.Client, migrations: Migration[]): Promise<Migration[]>` — emulates `PgDialect.migrate`: reads the last `created_at` from `drizzle.__drizzle_migrations` (creating schema and table if absent), applies **in one transaction** every migration whose `when` is greater, records each, and returns the ones it **skipped**. Statements split on `--> statement-breakpoint`, as drizzle does.
  - `fingerprint(client: pg.Client): Promise<string[]>` — a sorted, canonical list of lines describing every non-system object: `column <schema>.<table>.<name> <type> <notnull> <default>`, `constraint <schema>.<table>.<name> <pg_get_constraintdef>`, `index <pg_get_indexdef>`, `trigger <pg_get_triggerdef>`, `enum <schema>.<type> <labels>`, `function <schema>.<name> <md5 of prosrc>`, `acl <schema>.<table> <sorted relacl>`. Excludes schemas `pg_catalog`, `information_schema`, `pg_toast`, `pg_%` and `drizzle`.
  - `introspectInvariants(client: pg.Client): Promise<Invariants>` — `{ postgresMajor: number; partialUniqueIndexes: Entry[]; checkConstraints: Entry[]; triggers: Entry[] }`, each `Entry = { table: string; name: string; definition: string }`, sorted by `table` then `name`. Partial unique index = `indisunique AND indpred IS NOT NULL`; check constraint = `pg_constraint.contype = 'c'`; trigger = every trigger on a non-system table that is not internal (`tgisinternal = false`).
  - `checkInvariants(actual: Invariants, expected: Invariants): Finding[]` — rule `invariant-added` for something in the database and not the file, `invariant-removed` for the reverse, `invariant-changed` when a definition differs, `postgres-major` when the majors differ (and then nothing else is compared).
  - `INVARIANTS_PATH: string`

- [ ] **Step 1: Write the failing tests** in `scripts/test/migration-safety-db.test.ts`

```ts
it('applies all 16 migrations to an empty database', ...);              // applyMigrations returns [] skipped
it('is a no-op on a second run', ...);                                  // second applyMigrations applies nothing, fingerprint unchanged
it('skips a migration whose when is older than one already applied', ...); // reorder a copy: returns that migration as skipped
it('drops its scratch database even when a migration throws', ...);     // bad SQL; then the database is gone
it('finds the eight partial unique indexes, ten check constraints and three triggers the migrations create', ...);
it('matches the committed invariants file exactly', ...);               // checkInvariants(...) toEqual []
it('reports invariant-removed when an expected index is missing', ...);
it('reports invariant-added when the database has one the file does not', ...);
it('refuses to compare across Postgres majors', ...);
```

- [ ] **Step 2: Run with the namespace** `KOMTRU_INFRA_TESTS=1 KOMTRU_TEST_DB_PREFIX=komtru_t022 KOMTRU_MIGRATION_SAFETY_DB_PREFIX=komtru_t022_safety pnpm test:repo -t 'migration-safety'` — watch it fail
- [ ] **Step 3: Implement `tools/migration-safety/database.mjs` and its `.d.mts`**
- [ ] **Step 4: Capture the invariants file** through the same `--update-invariants` path Task 4 adds (until then, call `introspectInvariants` directly), then `pnpm exec prettier --write tools/migration-safety/invariants.json`
- [ ] **Step 5: Re-run, all pass. Confirm no stray database is left:** `docker exec komtru-postgres-1 psql -U komtru -d postgres -c '\l'` lists no `komtru_t022_safety_*`
- [ ] **Step 6: Commit** `feat(migration-safety): replay migrations and pin the schema-level invariants`

### Task 4: Forward apply from main, the CLI, and the README

**Files:**

- Create: `tools/migration-safety/check.mjs`, `tools/migration-safety/check.d.mts`
- Create: `tools/migration-safety/cli.mjs`
- Create: `tools/migration-safety/README.md`
- Modify: `package.json` (script `"migration:safety": "node tools/migration-safety/cli.mjs"`)
- Modify: `scripts/test/migration-safety-db.test.ts` (forward cases), `scripts/test/migration-safety.test.ts` (base-ref resolution cases)

**Interfaces:**

- Consumes: everything from Tasks 1–3.
- Produces:
  - `baseMigrations(ref?: string): { ref: string; migrations: Migration[] } | { ref: null; reason: string }` — reads the baseline folder out of git with `git show <ref>:apps/backend-api/drizzle/meta/_journal.json` and one `git show` per tag, never touching the working tree. `ref` defaults to `KOMTRU_MIGRATION_BASE_REF`, then `origin/main`, then `main`; when none resolves (a shallow clone, a fresh repo) it returns a stated reason instead of throwing.
  - `checkForward(): Promise<Finding[]>` — when there is no base ref, one `forward-skipped` finding of severity `warning`; otherwise two scratch databases: `head` gets HEAD's migrations from empty, `forward` gets the base's and then HEAD's, each through `applyMigrations`. Findings: `migration-skipped` for anything `applyMigrations` skipped on the second pass (with the two `when` values and the instruction to regenerate the migration so its timestamp is newer than `main`'s last), and `forward-drift` for every line on which the two fingerprints differ (up to 20 lines, then a count).
  - `runChecks(options: { static?: boolean }): Promise<{ findings: Finding[]; counts: Record<string, number> }>` — runs journal, lock, lint always; replay, invariants and forward when `options.static` is false.
  - CLI: `node tools/migration-safety/cli.mjs [--static] [--update-lock] [--update-invariants] [--base-ref <ref>]`. Prints one line per finding as `<check>/<rule> [tag] message`, then a summary. Exit 1 if any finding has severity `error`, 0 otherwise. `--update-*` write their file and exit 0 without running the checks.

`Finding` gains `severity: 'error' | 'warning'`; everything is `error` except `forward-skipped`.

- [ ] **Step 1: Write the failing tests**

```ts
// scripts/test/migration-safety.test.ts
it('resolves the base ref from KOMTRU_MIGRATION_BASE_REF', ...);
it('reports a reason instead of throwing when the base ref does not exist', ...);
it('reads the base folder out of git without touching the working tree', ...);  // HEAD~ or main resolves, git status stays clean
// scripts/test/migration-safety-db.test.ts
it('applies forward from the base ref to the same schema as a replay from empty', ...);  // checkForward() toEqual []
it('reports migration-skipped when a branch migration is older than the base head', ...);
it('reports forward-drift when a migration already on the base ref was edited', ...);
```

- [ ] **Step 2: Run both suites, watch the new cases fail**
- [ ] **Step 3: Implement `check.mjs`, `cli.mjs`, the `.d.mts`, the root script, and `tools/migration-safety/README.md`** — the README documents each rule id, the waiver syntax, `--update-lock` / `--update-invariants`, and the three facts about `PgDialect.migrate` at the top of this plan, because that is what a future migration author needs to pass the check
- [ ] **Step 4: Run the whole tool against the repository:** `KOMTRU_TEST_DIRECT_URL=postgresql://komtru:komtru@localhost:55432 KOMTRU_MIGRATION_SAFETY_DB_PREFIX=komtru_t022_safety pnpm migration:safety` — expect exit 0 and record the counts
- [ ] **Step 5: Both suites pass**
- [ ] **Step 6: Commit** `feat(migration-safety): apply forward from main and add the cli`

### Task 5: The CI job, and the ticket

**Files:**

- Modify: `.github/workflows/backend-api.yml` (job `migration-safety`; `deploy` gains it in `needs`; the T-022 comment on `deploy` goes)
- Modify: `scripts/test/ci-workflows.test.ts`
- Modify: `docs/tickets/02-backend-platform.md` (T-022 Status/Deferred)

The job: `needs: [lint, typecheck]`, `runs-on: ubuntu-latest`, `env.KOMTRU_TEST_DIRECT_URL` the same throwaway literal the `test` job uses, one `postgres` service copied field-for-field from `docker-compose.yml` on port `${LOCAL_PORTS.postgres}` with the same health check, `actions/checkout@v7` **with `fetch-depth: 0`** (the forward check needs `main`), the composite setup action, then `pnpm migration:safety`. No PgBouncer and no Redis: migrations run direct, as `src/db/migrator.ts` requires.

- [ ] **Step 1: Write the failing test changes** in `scripts/test/ci-workflows.test.ts`
  - `runs lint, typecheck, test, build and deploy in that order` becomes: expected job keys are `['lint', 'typecheck', 'test', 'build', 'deploy']` for every app, plus `migration-safety` after `test` for `backend-api`; `migration-safety` needs `['lint', 'typecheck']`
  - `deploys only from main…` gains: `backend-api`'s `deploy.needs` contains `migration-safety`, and the workflow text no longer says `T-022 adds`
  - new `describe('backend-api migration-safety job')`: it exists on `backend-api` and on no other app; its `postgres` service image, `env` and `ports` equal `docker-compose.yml`'s and `LOCAL_PORTS.postgres`; it health-checks that service; it has no `pgbouncer` and no `redis`; its checkout step sets `fetch-depth: '0'`; it uses `./.github/actions/setup`; its run line is `pnpm migration:safety`; its `KOMTRU_TEST_DIRECT_URL` matches the `test` job's
- [ ] **Step 2: Run `pnpm test:repo -t 'workflow'`, watch the new assertions fail**
- [ ] **Step 3: Add the job to `.github/workflows/backend-api.yml`** and put `migration-safety` in `deploy.needs`
- [ ] **Step 4: Run `pnpm test:repo`** — whole suite green
- [ ] **Step 5: Mark T-022 done** in `docs/tickets/02-backend-platform.md` with `- **Status:** Done (2026-10-05). Plan: …` and `- **Deferred:** …`. Do not run `pnpm tickets:index`.
- [ ] **Step 6: Commit** `feat(backend-api): gate the deploy on the migration-safety job`

### Task 6: Verification

- [ ] `pnpm exec turbo run build lint typecheck test --force`
- [ ] `pnpm exec prettier --check .`
- [ ] `pnpm test:repo`
- [ ] `KOMTRU_INFRA_TESTS=1 KOMTRU_TEST_DB_PREFIX=komtru_t022 KOMTRU_TEST_REDIS_URL=redis://localhost:56379/1 KOMTRU_MIGRATION_SAFETY_DB_PREFIX=komtru_t022_safety pnpm test:repo`
- [ ] `KOMTRU_MIGRATION_SAFETY_DB_PREFIX=komtru_t022_safety pnpm migration:safety`
- [ ] No `komtru_t022*` database left behind
- [ ] Fresh general-purpose opus reviewer on the whole branch diff (`superpowers:requesting-code-review`), then `superpowers:receiving-code-review`
