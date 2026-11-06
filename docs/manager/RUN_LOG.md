# Build manager run log

Append-only. Each build-manager run adds one entry at the bottom, following
[`MANAGER.md`](MANAGER.md) step 5. The manager reads the last few entries to estimate ticket
cost and to find work to resume.

## Waiting on the owner

- **T-037 access-control defaults.** Each was applied deny-by-default and listed under "Owner
  decisions pending" in `docs/superpowers/plans/2026-11-06-t-037-rbac-staff-admin.md`:
  - the holders of the risk, park, cases, config, compliance, analytics, growth and moderation
    permissions;
  - `moderation.act` removed from SUPPORT_LEAD;
  - `trade.dispute_escalate` removed from DISPUTE_REVIEWER;
  - `payout.retry` and `reconciliation.resolve` made two-person;
  - staff without an MFA factor cannot be granted a role;
  - an MFA reset needs an evidence reference, such as a ticket or call id;
  - only a SUPER_ADMIN may act on another staff member;
  - every refund is two-step until a "large refund" threshold is set;
  - the two initial SUPER_ADMINs are created with `pnpm db:bootstrap-super-admins`.
- ~~Mobile Buy/Sell switch (T-191).~~ Answered 2026-11-06: use the same Buy/Sell switch as desktop,
  in the mobile header, not Y2's role list.
- Q1 (hosting and the GitHub remote) still blocks T-005 and the T-183 push.
- Q3 (wallet) still blocks T-131.
- ~~Disputes in the MVP?~~ Answered 2026-11-06: yes. T-120, T-196, T-199, T-200 and the new T-221 are in the MVP.

## 2026-11-06 13:45 WAT — setup (interactive session, not a manager run)

- Plan: Pro. Usage at setup: 5h 58%, week 32%.
- Found uncommitted work on `main`, last touched 2026-10-15: T-028 social login, T-037 RBAC,
  avatars and the T-051 schema. Saved it unverified to branch `wip/main-uncommitted-2026-10-15`
  (commit f5bc7c4) so `main` is clean for the manager.
- Two worktrees were already open: `t-029-infra-isolation`, which is clean, and
  `t-051-business-verification`, with three commits plus uncommitted edits.
- The owner supplied UI Living Master v2. It was added as
  `docs/design-reference/Komtru — UI Living Master v2.html`, with its screen inventory in
  `screens-v2.tsv`. T-190 was created to remap it, and every undone UI ticket now depends on it.
- Ticket costs: none measured yet. The manager uses the defaults (5h 45%, week 8%) until three
  tickets have been logged.
- Next: T-190 (no infra needed) and T-051 (resume the worktree).

## 2026-11-06 16:12 WAT — T-190 run (interactive, outside the schedule)

- Used the end of a 5-hour window that was about to reset unspent.
- Usage at start: 5h 62%, week 32%. At end: 5h 71%, week 34%.
- Capacity: 1. Ticket: T-190, merged. One Sonnet implementer; no separate reviewer for this
  docs-only ticket. The manager checked it instead: `screen_index_v2.py --check` passes,
  `tickets:index` finds 166 tickets with no cycles, and the screen-index and visual-check tests
  and prettier are green.
- Ticket costs: T-190 5h-cost=9 week-cost=2. This is a planning ticket, so it is cheaper than a
  code ticket.
- Results:
  - All 437 v2 screens are mapped.
  - 30 new tickets, T-191 to T-220: 15 MVP, 15 deferred.
  - The MVP is now 37 of 102, and the total build 37 of 166.
- Follow-ups noted by the implementer:
  - visual-check still points at v1 and needs a v2 mode before v2 UI tickets attach visual checks.
  - The v2 mobile tab bar is unchecked; T-191 covers it.
- Next: T-051 (resume the worktree), T-029, T-037, T-072.

## 2026-11-06 16:30 WAT — T-051 and T-191 in parallel (interactive, outside the schedule)

- Usage at start: 5h 73%, week 34%. At end: 5h 91%, week 36%.
- Capacity: 2, both Sonnet. They passed the parallel rules: different modules, and only T-051
  has a migration.
- **T-051: merged.**
  - Resumed the existing worktree and merged main into it.
  - The review found 3 must-fixes, all fixed: the officer match trusted a typed name, social-proof
    index races, and a missing socket event. The fix pass also covered 5 should-fixes: the bank
    match is now keyed on an account-number HMAC, and the submission guards have tests.
  - Verified on the branch: 267/267 trust and verification tests with infrastructure, migration
    safety clean (32 migrations), typecheck and lint clean.
  - Verified names are now stored on NIN/BVN verification rows. That is within M6 D1, which
    forbids storing raw NIN/BVN numbers, not names.
  - Change for T-073: `readBankNameMatch(store, hasher, …)` now takes the hasher.
- **T-191: saved after review.**
  - Implemented: 100 web-app-ui tests and 845 ui-kit tests pass.
  - The review found 3 must-fixes and 9 should-fixes, written to `docs/ui-review/T-191/REVIEW.md`
    on branch `t-191-v2-shell-rework`.
  - The fix pass was not started, because the 5-hour window passed 88%.
- Ticket costs, for the two together including both reviews and the T-051 fix: 5h-cost=18
  week-cost=2. Per ticket that is about 9 and 1.
- Next: the T-191 fix pass. Resume the worktree; a fresh Sonnet fixer works from REVIEW.md.
  Then T-037, which should reuse the `wip/main-uncommitted-2026-10-15` RBAC work, and T-072.

## 2026-11-06 17:30–18:40 WAT — T-191 fix and T-037 in parallel (interactive, outside the schedule)

- Usage at start: 5h 0% (fresh window), week 36%. At end: 5h 48%, week 43%.
- **T-191: merged.** A fresh Sonnet fixer handled all 12 review items, including the owner's
  mobile Buy/Sell ruling, and created T-222 for the tab-bar re-base (MVP). Verified: ui-kit
  850/850 and web-app-ui 115/115 tests; lint, types and prettier clean.
- **T-037: merged.**
  - The Sonnet implementer took the RBAC catalogue from the wip branch. The catalogue has 14
    roles, 70 permissions and 212 grants. The ticket also brought MFA-only staff login and admin
    endpoints with two-person approvals.
  - Because this is access control, the review ran on **Opus**. It found 5 must-fixes and 9
    should-fixes, all fixed. The must-fixes were: self-reinstate, an approval not bound to its
    payload, missing DENIED audit rows, grants permanent by default, and no cap on SUPER_ADMIN
    holders.
  - Verified: 2,499 identity and trust tests with infrastructure; migration safety clean; lint
    and types clean on the branch and on main, after rebuilding the packages' `dist`.
- Ticket costs:
  - T-191 fix: about 5h 6, week 1.
  - T-037 (build, Opus review, fix): about 5h 40, week 6. This is the first measured
    security-heavy ticket.
- `wip/main-uncommitted-2026-10-15`: its T-037 and T-051 parts are now superseded. It still
  holds T-028 social login and the avatar work, so keep it until those tickets are done.
- Next: T-072 (funding a trade; money, so an Opus implementer) or T-038 (staff invitations, now
  unblocked by T-037).

## 2026-11-06 18:28 WAT — skipped: locked (lock from 2026-11-06T17:17:53Z; 5h 62%, week 44%)
