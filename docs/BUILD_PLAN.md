# Build plan under Pro plan limits

**Set up 2026-11-06.** The build now runs on the owner's personal Claude **Pro** account, so
it is bound by two rolling limits:

- a **5-hour window**, which at setup was 58% used;
- a **weekly all-models cap**, which at setup was 32% used and resets Tuesdays at 15:00 WAT.

Running out mid-ticket loses work. That happened on 2026-10-06, when three parallel agents
burned the budget in four hours and nothing merged. So this plan sizes work to the budget
rather than to the backlog.

|                      | Where                                                                    |
| -------------------- | ------------------------------------------------------------------------ |
| Ticket list          | [`TICKETS.md`](TICKETS.md), with detail in [`tickets/`](tickets/)        |
| Live progress        | [`PROGRESS.md`](PROGRESS.md), or `pnpm progress` / `pnpm progress:write` |
| What each run did    | [`manager/RUN_LOG.md`](manager/RUN_LOG.md)                               |
| Manager instructions | [`manager/MANAGER.md`](manager/MANAGER.md)                               |
| MVP cut              | [`MVP.md`](MVP.md)                                                       |

## How it runs

**A manager on a timer, sub-agents per ticket.**

- A local scheduled task, `komtru-build-manager`, starts a fresh Claude Code session every
  3 hours.
- The session follows `manager/MANAGER.md`. It checks the budget, picks Ready tickets, and runs
  each ticket through three subagents: an **implementer** in its own worktree, a fresh
  **reviewer**, and the implementer again as **fixer**.
- It then verifies, merges into local `main`, updates the ticket docs and logs the run.
- Nothing is pushed.

**Why every 3 hours.** The 5-hour window rolls, so a run every 3 hours lands at least once in
every window. Most runs that find no budget stop after a single usage check, which costs
almost nothing. A lock file stops two runs from overlapping.

**How many agents.** The manager decides each run, from measured usage (`MANAGER.md` step 0):

| Situation                                                | Tickets in parallel | Agents live at once                      |
| -------------------------------------------------------- | ------------------- | ---------------------------------------- |
| Weekly at 85% or more, or the 5-hour window nearly spent | 0: log and stop     | 0                                        |
| Normal                                                   | 1                   | 1 (implementer, reviewer, fixer in turn) |
| Fresh 5-hour window, two independent Ready tickets       | 2                   | 2                                        |

The ceiling is 2. More parallelism does not finish more tickets on a fixed budget. It only
spends the budget faster and raises the odds of dying mid-ticket. The roles are sequential
within a ticket, so 2 tickets never means more than 2 agents live.

**Where the budget goes.**

- **Sonnet for implementers and reviewers.** Opus only for money, ledger and security tickets
  (T-072–T-076, T-080, T-182), where a subtle bug costs more than the tokens.
- **The fixer is the resumed implementer**, not a fresh agent, so it does not pay to re-read
  the codebase.
- **The manager writes no code** and reads only summaries.
- **Checkpointing.** Implementers commit after every green step. The manager checks usage
  between phases and, at 88% of the 5-hour window, saves the branch and stops. The next run
  resumes from there.
- **Owner reserve.** Up to 15% of each week is never spent by the manager. You keep it for
  your own use.

## Expected throughput

These are estimates until the run log has real numbers. The manager logs each ticket's cost
and re-plans from the median of the last 5.

- **Per ticket cycle:** about 45% of a 5-hour window and about 8% of the week (defaults).
- **Per week:** 85% usable ÷ 8% ≈ **9–10 tickets**.
- **Backlog:** 51 MVP tickets, plus the new tickets T-190 creates from the UI master v2
  (likely 10–25 more, about half MVP). That is roughly **60 MVP tickets, about 6–7 weeks**.
  The whole build (about 120 tickets) is roughly **12–14 weeks**.
- If the real cost per ticket comes in lower, the manager runs 2 in parallel more often and
  these dates move in. A Max plan would cut them by roughly the multiple of its allowance.

## What the manager needs from the machine

- The **Claude desktop app open** and the Mac awake. Scheduled tasks only run while the app is
  running; a missed run fires on next launch.
- **Docker running** for Postgres and Redis. Without it the manager only does tickets that need
  no infrastructure.
- `docs/specs/backend-apis.env` present in the main checkout.

## UI Living Master v2 (2026-11-06)

The owner's new master, `design-reference/Komtru — UI Living Master v2.html`, has 437 screens.
v1 had 210. The trade detail screens, desktop and tablet, and the whole TrustOps console are
redrawn, and Create a Trade, resolution execution and seller supporting screens are new.
Epic 18 records the full difference. **T-190** remaps every screen to a ticket and creates the
tickets the new screens need. Every undone UI ticket depends on it, and the manager runs it
first. Backend tickets are unaffected and continue in parallel.

## Owner decisions still open

- Q3 (wallet) blocks T-131.

New questions raised by runs collect at the top of `manager/RUN_LOG.md`.
