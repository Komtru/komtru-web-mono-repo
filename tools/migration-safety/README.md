# migration-safety

`pnpm migration:safety` — the check `backend-api`'s deploy waits for (T-022).

The backend's Vitest `globalSetup` already proves every migration applies to an empty database on
every infra run. This tool is the rest: the things a replay from nothing cannot see.

## What the migrator actually does, and why it matters

Everything here follows from three properties of `PgDialect.migrate`, the drizzle function
`src/db/migrator.ts` calls:

1. **It decides what to apply by timestamp alone.** It reads the single newest `created_at` in
   `drizzle.__drizzle_migrations` and applies every journal entry whose `when` is greater. A
   migration generated _before_ one that is already applied is skipped silently, forever. Two
   branches generating migrations in parallel is exactly how that happens — whichever merges second
   may carry the older timestamp.
2. **It runs the whole pending set in one transaction.** `CREATE INDEX CONCURRENTLY` cannot be used
   at all, and any lock a migration takes is held until the last pending migration commits. A
   finding from this tool is therefore never fixed by adding `CONCURRENTLY`.
3. **It never re-checks an applied migration's hash.** Editing a migration that has already run
   changes nothing in the databases it ran on, and leaves them permanently different from a fresh
   one. Fix forward in a new migration instead.

## The checks

| check        | rule                                                 | what it means                                                                        |
| ------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `journal`    | `journal-complete`                                   | the journal, the `.sql` files and `meta/*_snapshot.json` do not describe one history |
| `journal`    | `journal-order`                                      | a migration's `when` is not after the previous one's — the migrator would skip it    |
| `journal`    | `snapshot-chain`                                     | a snapshot's `prevId` is not the previous snapshot's `id`                            |
| `lock`       | `migration-edited`                                   | a migration's bytes or timestamp changed after it was locked                         |
| `lock`       | `migration-unlocked`                                 | a new migration is not in `migrations.lock.json`                                     |
| `lock`       | `migration-removed`                                  | a locked migration is gone from the journal                                          |
| `lint`       | see below                                            | a statement that is free on an empty table and an outage on a populated one          |
| `lint`       | `unknown-waiver` / `waiver-reason` / `unused-waiver` | a waiver in `waivers.json` that cannot be trusted                                    |
| `invariants` | `invariant-added/-removed/-changed`                  | a partial unique index, check constraint or trigger that is not the one on record    |
| `forward`    | `migration-skipped`                                  | applying this branch on top of `main` would not run one of its migrations            |
| `forward`    | `forward-drift`                                      | this branch builds a different schema on top of `main` than it does from empty       |
| `forward`    | `forward-rewritten`                                  | a migration `main` already has was renamed or reordered                              |

### Lint rules

`drop-object`, `index-lock`, `drop-index-lock`, `concurrently-in-transaction`, `not-null-no-default`,
`type-change`, `constraint-scan`, `rename`, `backfill`. Each one's reason is printed with the
finding and lives in `RULES` in `lint.mjs`. A rule only fires against a table that existed **before**
the migration under test: anything done to a table the same migration creates is free.

### Waiving a rule

Waivers live in `waivers.json`, keyed by migration tag and rule, with the reason as the value:

```json
{
  "0042_orders_index": {
    "index-lock": "orders is still under ten thousand rows and this deploy has a maintenance window"
  }
}
```

They are not comments in the migration, deliberately: this tool's strongest rule is that a migration
which has already been applied is never edited again, and a comment line changes the file's hash
while changing nothing the migrator will ever read. The three waivers in the file today were written
for migrations that were already on `main`; putting them in the SQL made the forward check report
all three as migrations the migrator would never apply, which was correct.

The rule id must exist, the reason must be at least 20 characters, and a waiver that nothing in the
migration trips is itself a failure — so a waiver cannot outlive the statement it was written for.

## Writing a migration that passes

- Generate it **on top of the latest `main`**. If you generated before rebasing, regenerate: the
  `when` in `meta/_journal.json` has to be newer than every migration already on `main`.
- Run `pnpm migration:safety --update-lock` and commit `migrations.lock.json` with the migration.
- If the lint fires and the statement is genuinely safe, add the rule and the reason to
  `waivers.json` under the migration's tag.
- If the migration adds a partial unique index, a check constraint or a trigger, run
  `pnpm migration:safety --update-invariants` and commit `invariants.json` too. That file is the
  maintained list of the rules the database enforces on the application's behalf; a diff to it is the
  point.
- Never edit a migration that is already on `main`. Fix forward.

## Running it

```
pnpm migration:safety                 # everything; needs a Postgres
pnpm migration:safety --static        # journal, lock and lint only
pnpm migration:safety --base-ref <ref>
pnpm migration:safety --update-lock
pnpm migration:safety --update-invariants
```

`KOMTRU_TEST_DIRECT_URL` points it at Postgres (default `postgresql://komtru:komtru@localhost:55432`,
the `docker-compose.yml` stack). It creates and drops its own databases, named
`${KOMTRU_MIGRATION_SAFETY_DB_PREFIX}_<label>` — set that prefix when another run might be using the
same server. `invariants.json` records the Postgres major it was captured on, because
`pg_get_indexdef` prints differently across majors; the check refuses to compare across them rather
than reporting the difference as drift.
