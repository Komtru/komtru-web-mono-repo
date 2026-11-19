# Running more than one agent at once

Two features can be built at the same time, one git worktree each under
`.claude/worktrees/f-0xx-slug`. Three cannot: three parallel tickets ran the budget out
mid-ticket on 2026-10-06 and lost the night's work. **Never more than two.**

## When two may run together

All of these must hold:

- They touch **different modules** (`apps/backend-api/src/modules/<x>`) or different apps.
- **At most one adds a database migration.** Drizzle's `000N_` numbering and the
  `drizzle/meta/_journal.json` entry collide otherwise.
- Neither is cross-cutting infrastructure work.

## An agent runs its own tests, never the full suite

**Standing rule, set by the owner on 2026-11-19. An implementer agent runs only the tests it
created or changed.** Never `turbo run lint typecheck test` across the repo, with or without
`--force`, and never `prettier --check .` over the whole tree.

What an agent runs instead, scoped to the files it touched:

- its own test files, by path: `pnpm --filter @komtru/<pkg> exec vitest run <paths>`;
- lint and typecheck for the packages it changed only: `pnpm --filter @komtru/<pkg> exec tsc --noEmit`
  and that package's lint script;
- `prettier --write` on the changed files.

**Why:** a whole-repo run is ~10 minutes on a quiet machine and ~17 under contention, it is
mostly re-running tests the agent did not touch, and several agents doing it at once is what
produces the phantom 5-second timeouts described below. It is the single largest cost in a
build run, and it buys an agent almost nothing about its own change.

**CI owns whole-repo verification.** Nobody runs the full suites on this machine — push to
`staging` and read the workflow result. That is also the only place a cross-branch break (the
`ProofTile` case below) is visible at all. `lint`, `typecheck`, `format:check` and a single
targeted test file stay cheap and are still fine locally when something specific needs checking.

## Shared resources that force serialisation

The local Docker Postgres and Redis are **one** instance shared by every agent on the machine.

- Each agent needs a distinct `KOMTRU_TEST_DB_PREFIX` and its own Redis database. The worker
  database name is `${TEST_DB_PREFIX}_${VITEST_POOL_ID}` with no run id, so two agents sharing a
  prefix drop each other's databases.
- **Only the orchestrator runs `KOMTRU_INFRA_TESTS=1`,** and only on the merged branch. Parallel
  agents run unit tests. Agents must never run `pnpm infra:up` or `pnpm infra:down`.
- **Only the orchestrator runs `pnpm tickets:index`.** It regenerates `docs/TICKETS.md`, which
  conflicts across branches.
- Each worktree needs its own `pnpm install` and `pnpm env:backend --force`. Turbo's cache is
  shared across worktrees, so always verify a merge with `--force`.
- Subagents of one session share that session's scratchpad. Give each one its own subdirectory,
  or two of them writing `proxy.mjs` for a visual check will overwrite each other.

## Two failure modes that look like something else

**"The whole-repo suite is flaky under turbo load."** It usually isn't. On 2026-11-13 a
`turbo run lint typecheck test --force` failed twice with _different_ suites down, both on
5-second timeouts, at load average 82 with 62 node processes — because a second Claude session
was building at the same time. Each suite passed alone and `--concurrency=2` gave 37/37. Check
`uptime` before debugging the code.

**A branch that only adds files can still break the target.** F-029 deleted a component
(`ProofTile`) that the already-merged F-028 imported. Each branch compiled; the merge did not.
When two features run in parallel in one app, run `git merge-tree` against the current target
branch _before_ the review, not at merge time.
