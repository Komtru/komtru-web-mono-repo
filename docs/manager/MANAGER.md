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
3. Work out `est`, the expected cost of one ticket cycle as a percent of the 5-hour window. It
   is the median `5h-cost` of the last 5 completed tickets in `RUN_LOG.md`, or **45** if there
   are fewer than 3. Do the same for `est_week` (default **8**).
4. Decide the run's **capacity**, the number of ticket cycles to start:
   - weekly used ≥ **85**, or weekly used + `est_week` > 85: capacity 0. Up to 15% of the week
     is the owner's reserve for their own use and is never spent.
   - 5-hour used + `est` > **90**: capacity 0.
   - 5-hour used + 2×`est` ≤ 90, and two Ready tickets pass the parallel rules in step 2:
     capacity 2.
   - otherwise capacity 1.
   - **Never more than 2.** Three parallel tickets ran out the budget mid-ticket on 2026-10-06
     and lost the night's work.
5. With capacity 0, only resume half-finished work if it is a cheap tail, such as a merge that
   only needs verifying. Otherwise log `skipped: budget (5h N%, week M%)`, remove the lock and
   stop. Usage resets on its own, and the next scheduled run picks up.

## 1. Reconcile what the last runs left behind

- Run `git worktree list` and `git branch --list 't-*' 'wip/*'`. A worktree whose ticket is not
  Done is **in-flight work**. Resume it before starting anything new; in-flight tickets use up
  capacity first.
- The `wip/main-uncommitted-2026-10-15` branch holds unverified T-028, T-037, T-040 and T-051
  work found uncommitted on `main`. When the manager starts any of those tickets, the
  implementer cherry-picks the relevant files from that branch instead of rewriting them. Once
  all four are Done, delete the branch and remove this bullet.
- `t-051-business-verification` has three commits plus uncommitted edits. It conflicts with the
  `wip` branch's migration 0031. Its implementer must keep one migration and renumber it if
  `main` has moved on.
- Bring infrastructure up: `pnpm infra:up`. If Docker is not running, log it and run only
  tickets that need no Postgres or Redis, such as T-190 or docs and UI planning.

## 2. Pick the tickets

1. `pnpm tickets:index && pnpm progress:write`, then read the **Ready** table in `docs/PROGRESS.md`.
2. Priority order:
   1. in-flight work;
   2. **T-190** (UI master v2 remap) until it is done, because every UI ticket waits on it;
   3. Ready MVP tickets on the critical path in `docs/TICKETS.md`;
   4. other Ready MVP tickets;
   5. deferred tickets.
3. Two tickets may run at once only if all of these hold:
   - they touch different modules (`apps/backend-api/src/modules/<x>`, or different apps);
   - **at most one adds a database migration**, because Drizzle migration numbers and the
     `migrations.lock.json` journal collide;
   - neither is a cross-cutting infrastructure ticket (T-029, T-182, T-183).
4. Never pick T-005 or T-183 (owner decision Q1 and the push rule), or any ticket whose
   status is `Blocked (Qn)`.

## 3. Run each ticket: implement → review → fix → merge

Use one git worktree per ticket under `.claude/worktrees/t-0xx-slug`, branch `t-0xx-slug` from
`main`. The roles below are separate subagents (Agent tool). With capacity 2, start both
implementers in the same message so they run in parallel.

| Role        | Model                                                                                                                        | Brief                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementer | `sonnet` by default. `opus` for money and security: T-072–T-076, T-080, T-182, and any ticket whose `Model:` line says opus. | Give it the ticket's full text from `docs/tickets/`, the worktree path, and the workflow in `docs/TICKETS.md` (plan in `docs/superpowers/plans/`, test first, conventional commits, UI tickets run the visual check against `docs/design-reference/Komtru — UI Living Master v2.html`). Tell it: commit after every green step, so a run cut short loses nothing; do not merge; report what is done and what is not. |
| Reviewer    | `sonnet`, fresh context                                                                                                      | Review the whole branch diff against the ticket's acceptance criteria and `superpowers:requesting-code-review`. Return a numbered list of must-fix and should-fix items. Do not edit.                                                                                                                                                                                                                                |
| Fixer       | The same implementer, resumed with SendMessage so it keeps its context. A fresh agent would have to re-read everything.      | Fix the must-fix items and run the full verification.                                                                                                                                                                                                                                                                                                                                                                |

Between phases, call `get_usage` again. If the 5-hour window is at **88% or more**, do not
start the next phase. Instead:

1. Have the active agent commit what it has, or commit it yourself as
   `chore(<scope>): save in-progress T-0xx, unverified`. commitlint rejects a `wip` type and
   headers over 100 characters.
2. Set the ticket's status line to
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
   `git merge --no-ff t-0xx-slug -m "chore(merge): merge T-0xx <lower-case summary>"`.
3. Mark the ticket done: `- **Status:** Done (YYYY-MM-DD). Plan: <path>. Review: <n> items fixed.`
4. Run `pnpm tickets:index && pnpm progress:write`, commit as
   `docs(tickets): mark T-0xx done and regenerate the index`, then remove the worktree.
5. **Never push.** Nothing leaves this machine until T-183 and the owner's go-ahead.

If a ticket fails verification twice, leave it on its branch with an in-progress status naming
the failure. Log it, and do not loop on it. Pick something else next run, and say in the log
that it needs the owner.

## 4. Questions for the owner

If a ticket needs a product decision the docs do not answer, it ships with the documented
default (design §12) where one exists. Otherwise park it, and add the question to the
`## Waiting on the owner` section at the top of `RUN_LOG.md`. Never guess on money rules.

## 5. Close the run (always, even after a budget stop)

1. Call `get_usage` once more. Each ticket's cost is the 5-hour and weekly percent change across
   its phases, or across the whole run when two tickets ran together.
2. Append one entry to `RUN_LOG.md`:

   ```
   ## YYYY-MM-DD HH:MM WAT — run summary
   - Usage at start: 5h N%, week M%. At end: 5h N%, week M%.
   - Capacity: k. Tickets: T-0xx (merged | saved at <phase> | failed: reason)
   - Ticket costs: T-0xx 5h-cost=NN week-cost=N
   - Next: what the next run should pick up
   ```

3. `pnpm progress:write`, then commit `RUN_LOG.md` and `PROGRESS.md` as
   `docs(build): log the build-manager run of YYYY-MM-DD`.
4. Remove `.claude/manager.lock`.
5. End the session's reply with the two `pnpm progress` bars, MVP and total. The owner wants
   them after every run.
