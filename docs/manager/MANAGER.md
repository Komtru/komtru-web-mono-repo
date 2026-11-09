# Build manager — run protocol

A scheduled task runs this protocol (`komtru-build-manager`, every 3 hours). Each run starts
cold, with no memory of earlier runs. Everything it needs is in the repo:

- this file, for what to do;
- [`../BUILD_PLAN.md`](../BUILD_PLAN.md), for why;
- [`RUN_LOG.md`](RUN_LOG.md), for what happened before;
- [`../PROGRESS.md`](../PROGRESS.md), for where things stand.

Edit this file to change the manager's behaviour. The schedule only points here.

The manager **orchestrates; it never writes product code itself.** Keep its own context small.
Read summaries, not whole files, and delegate everything heavy to subagents.

## 0. Gate: is there budget, and is another run active?

1. Call `mcp__ccd_session_mgmt__get_usage` (load it with ToolSearch first). Read the
   **5-hour** and **weekly** percentages.
2. Lock: if `.claude/manager.lock` exists and its timestamp is less than 4 hours old, another
   run is active. Append a one-line `skipped: locked` entry to `RUN_LOG.md` and stop. Otherwise
   write the lock with the current ISO time. Delete it at the end of the run, on every exit path.
3. Work out `est`, the expected cost of one feature cycle (or one layer of a split feature) as a percent of the 5-hour window. It
   is the median `5h-cost` of the last 5 completed tickets or feature layers in `RUN_LOG.md`, or **45** if there
   are fewer than 3. Do the same for `est_week` (default **8**).
4. Decide the run's **capacity**, the number of feature cycles to start:
   - weekly used ≥ **85**, or weekly used + `est_week` > 85: capacity 0. Up to 15% of the week
     is the owner's reserve for their own use and is never spent.
   - 5-hour used + `est` > **90**: capacity 0.
   - 5-hour used + 2×`est` ≤ 90, and two Ready features pass the parallel rules in step 2:
     capacity 2.
   - otherwise capacity 1.
   - **Never more than 2.** Three parallel tickets ran out the budget mid-ticket on 2026-10-06
     and lost the night's work.
5. With capacity 0, only resume half-finished work if it is a cheap tail, such as a merge that
   only needs verifying. Otherwise log `skipped: budget (5h N%, week M%)`, remove the lock and
   stop. Usage resets on its own, and the next scheduled run picks up.

## 1. Reconcile what the last runs left behind

- Run `git worktree list` and `git branch --list 't-*' 'f-*' 'wip/*'`. A worktree whose feature is
  not Done is **in-flight work**. Resume it before starting anything new; in-flight features use
  up capacity first. A feature whose status says one layer is done (for example "backend merged,
  UI in progress") resumes at the other layer.
- Check the features' `- **Status:**` lines in `docs/tickets/FEATURE_MAP.md` against what is merged
  on `main`. A feature is Done only if its absorbed tickets are all Done **and** a user can do the
  thing in an app. If tickets are all merged but the status still says `Not started`, correct the
  status in the feature map (the status line only, not the definition).
- Bring infrastructure up: `pnpm infra:up`. If Docker is not running, log it and run only
  features that need no Postgres or Redis, such as UI-only work or docs and planning.

## 2. Pick the features

The unit of work is the **feature** in [`../tickets/FEATURE_MAP.md`](../tickets/FEATURE_MAP.md): a
thing a user can do, with its backend and frontend together. The old T- tickets remain the detailed
specification; a feature reaches them through its `Absorbs:` line.

1. `pnpm tickets:index && pnpm progress:write`, then read `docs/PROGRESS.md`: the **Backend done,
   UI outstanding** group and the **Ready features** table (every dependency done, MVP first).
   `pnpm progress --list` shows the same from the terminal.
2. Priority order:
   1. in-flight work;
   2. a **Backend done, UI outstanding** MVP feature. Prefer these over starting a new
      backend-only feature: the engine exists and only the UI is missing, so they are the
      cheapest route to working product;
   3. other Ready MVP features, journey order (Arrive, Propose, Fund, Fulfil, Deliver, Issues);
   4. deferred features.
3. **A feature is Done only when a user can do the thing in an app.** Backend alone never closes
   one, and neither does UI over stubs. Set `- **Status:** Done` in the feature map only when
   both layers are merged and the visual check has passed. The status values are `Done`,
   `Backend done, UI outstanding` and `Not started`; progress counts only `Done`.
4. A feature's implementer builds **both** layers. Hand it the feature's full entry from the
   feature map and the full text of every absorbed ticket still `(todo)`, including the
   `- **Status:**` notes, which carry the engineering detail. Where that is too big for one cycle,
   split by layer **within the feature** and say so in the status line (for example
   `Backend done, UI outstanding`, or an in-progress note naming the layer); never mark the
   feature Done on the backend half.
5. UI work runs the visual check against
   `docs/design-reference/Komtru — UI Living Master v2.html`.
6. Two features may run at once only if all of these hold:
   - they touch different modules (`apps/backend-api/src/modules/<x>`, or different apps);
   - **at most one adds a database migration**, because Drizzle migration numbers and the
     `migrations.lock.json` journal collide;
   - neither is a cross-cutting infrastructure feature (F-005 test isolation, F-077 security
     review, F-078 first push).
7. Never pick F-075 (hosting, owner decision Q1), F-078 (the push rule), or any feature whose
   absorbed tickets are `Blocked (Qn)`.

Parallel agents must each export a distinct `KOMTRU_TEST_DB_PREFIX` (and Redis database). The
worker database name is built in `apps/backend-api/test/support/db.ts` as
`${TEST_DB_PREFIX}_${VITEST_POOL_ID}` with no run id, so two concurrent runs under one prefix
drop each other's databases.

## 3. Run each feature: implement → review → fix → merge

Use one git worktree per feature under `.claude/worktrees/f-0xx-slug`, branch `f-0xx-slug` from
`main`. (Older `t-0xx-slug` worktrees from before the feature plan resume as they are.) The roles below are separate subagents (Agent tool). With capacity 2, start both
implementers in the same message so they run in parallel.

| Role        | Model                                                                                                                                                  | Brief                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementer | `sonnet` by default. `opus` for money and security: any feature absorbing T-072–T-076, T-080 or T-182, and any whose tickets' `Model:` line says opus. | Give it the feature's entry from `docs/tickets/FEATURE_MAP.md` and the full text of its absorbed tickets from `docs/tickets/`, the worktree path, and the workflow in `docs/TICKETS.md` (plan in `docs/superpowers/plans/`, test first, conventional commits, UI work runs the visual check against `docs/design-reference/Komtru — UI Living Master v2.html`). Tell it: commit after every green step, so a run cut short loses nothing; do not merge; report what is done and what is not. |
| Reviewer    | `sonnet`, fresh context                                                                                                                                | Review the whole branch diff against the feature's scope and its absorbed tickets' acceptance criteria, both layers and `superpowers:requesting-code-review`. Return a numbered list of must-fix and should-fix items. Do not edit.                                                                                                                                                                                                                                                          |
| Fixer       | The same implementer, resumed with SendMessage so it keeps its context. A fresh agent would have to re-read everything.                                | Fix the must-fix items and run the full verification.                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Between phases, call `get_usage` again. If the 5-hour window is at **88% or more**, do not
start the next phase. Instead:

1. Have the active agent commit what it has, or commit it yourself as
   `chore(<scope>): save in-progress F-0xx, unverified`. commitlint rejects a `wip` type and
   headers over 100 characters.
2. Set the status line of the feature (and of the absorbed ticket being worked) to
   `- **Status (YYYY-MM-DD): in progress** — <phase reached>; next: <phase>; open review items: …`.
3. Go to step 5. The next run resumes from the branch.

**Merging**, which the manager does itself:

1. First run `pnpm --filter "./packages/**" build`. Apps typecheck against the packages' built
   `dist`, so stale output there shows up as false type errors, which happened after T-051 and
   T-191. Then run the whole-repo checks in the worktree, and again on `main` after merging:
   `pnpm -w exec turbo run lint typecheck test --force` (scoped with `--filter` to the touched
   packages if the full suite will not fit the budget), then `pnpm format:check` and
   `pnpm migration:safety` if there is a migration.
2. On `main`, run
   `git merge --no-ff f-0xx-slug -m "chore(merge): merge F-0xx <lower-case summary>"`.
3. Mark each absorbed ticket whose work is merged done, keeping its engineering notes:
   `- **Status:** Done (YYYY-MM-DD). Plan: <path>. Review: <n> items fixed.` Then set the feature's
   `- **Status:**` in `docs/tickets/FEATURE_MAP.md`: `Done` only if both layers are merged and a
   user can do the thing in an app; otherwise `Backend done, UI outstanding`.
4. Run `pnpm tickets:index && pnpm progress:write`, commit as
   `docs(tickets): mark F-0xx done and regenerate the index` (or `... record F-0xx backend done ...`), then remove the worktree.
5. **Never push.** Nothing leaves this machine until T-183 and the owner's go-ahead.

If a feature fails verification twice, leave it on its branch with an in-progress status naming
the failure. Log it, and do not loop on it. Pick something else next run, and say in the log
that it needs the owner.

## 4. Questions for the owner

If a feature needs a product decision the docs do not answer, it ships with the documented
default (design §12) where one exists. Otherwise park it, and add the question to the
`## Waiting on the owner` section at the top of `RUN_LOG.md`. Never guess on money rules.

## 5. Close the run (always, even after a budget stop)

1. Call `get_usage` once more. Each feature's cost is the 5-hour and weekly percent change across
   its phases, or across the whole run when two features ran together.
2. Append one entry to `RUN_LOG.md`:

   ```
   ## YYYY-MM-DD HH:MM WAT — run summary
   - Usage at start: 5h N%, week M%. At end: 5h N%, week M%.
   - Capacity: k. Features: F-0xx (merged | layer merged, other outstanding | saved at <phase> | failed: reason)
   - Feature costs: F-0xx 5h-cost=NN week-cost=N
   - Next: what the next run should pick up
   ```

3. `pnpm progress:write`, then commit `RUN_LOG.md` and `PROGRESS.md` as
   `docs(build): log the build-manager run of YYYY-MM-DD`.
4. Remove `.claude/manager.lock`.
5. End the session's reply with the two `pnpm progress` **feature** bars, MVP and total, then one
   line per feature touched: Done, backend done with the UI outstanding (or the reverse), saved at
   which phase, or failed and why. Say which **Backend done, UI outstanding** features remain. The
   owner wants this after every run.
