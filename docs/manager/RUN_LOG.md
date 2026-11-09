# Build manager run log

Append-only. Each build-manager run adds one entry at the bottom, following
[`MANAGER.md`](MANAGER.md) step 5. The manager reads the last few entries to estimate ticket
cost and to find work to resume.

## Waiting on the owner

- **T-049 trade-standard seed values** (placeholders): a 48h inspection window and 7-day delivery
  for both categories. Electronics requires 4 photos plus a video; Fashion 3 photos and no video.
  A buyer may extend the window by up to 48h more, configurable up to 336h.
- **T-038 staff invitations:**
  - Only a SUPER_ADMIN may invite.
  - The invite token is shown once and has to be sent by hand until a notification template
    exists. Should T-038 add email delivery?
  - "Binds on verification" is record-only: the invitee still needs MFA and an explicit accept.
- **T-048 configuration defaults** (listed in `docs/superpowers/plans/2026-11-06-t-048-config.md`):
  - `trades.payment_deadline_hours = 24`;
  - `trades.delivery_deadline_days = 7`;
  - `config.manage` is SUPER_ADMIN only, so OPERATIONS_ADMIN can read settings but not change them.
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
- **Q16, the T-046 city seed.** It is merged with a default list: 37 states and 129 cities (the 37 capitals plus 92 commercial
  cities) in `apps/backend-api/src/modules/geo/seed/nigeria-locations.seed.ts`. Review the list. Staff can also add,
  rename or deactivate cities later through `/admin/geo`. `geo.manage` is held by SUPER_ADMIN and OPERATIONS_ADMIN.
- **T-061 proposal-flow defaults** (merged 2026-11-07; listed in `docs/superpowers/plans/2026-11-07-t-061-proposal-flow.md`):
  - seller proof media is stored as `PRIVATE_CASE` files with the buyer granted access, because files has
    no trade-proof category;
  - a proof file is accepted only if it is unused elsewhere, and a trade holds at most 20 proof files;
  - the buyer's proof access is revoked when a trade is declined, cancelled or expires unfunded;
  - either party may cancel before funding, and the initiator may cancel before the counterparty binds;
  - a certified merchant who asks to be the BUYER is refused (403 `MERCHANT_CANNOT_BUY`), not silently
    switched to SELLER.
- **T-072 funding: blocks merge.** Where does the buyer protection fee sit between funding and release? The AC
  says "fee liability", but the chart of accounts has no fee-liability account. Default built: a second credit
  line on the trade's escrow liability account (isolated in `fundingJournalLines`). A separate account needs a
  new enum value and a migration that rewrites account keys. The branch `t-072-funding` is reviewed, fixed and
  green, waiting on this answer. Other money defaults in `docs/superpowers/plans/2026-11-07-t-072-funding.md`:
  - under-, over- or reversed payment, or money on a closed attempt or a trade no longer awaiting payment, is
    held in full for manual review (no auto-refund);
  - reference `fund-<uuid>`; a buyer with no email gets 422;
  - a checkout Paystack never saw can be replaced after 30 minutes, a declined card after 10, an abandoned
    one at once; at most 10 attempts per trade, 1 minute apart;
  - whether attempt expiry should tie to `trades.payment_deadline_hours` (a trade-side deadline job);
  - stock reservation (T-056) consumes `ledger.payment.escrow_funded`.
- **T-041 avatar defaults** (merged 2026-11-09; listed in `docs/superpowers/plans/2026-11-09-t-041-avatars.md`):
  - replacing or removing an avatar tombstones the old file; provider images are JPEG, PNG or WebP only, checked
    by magic bytes, at most 5 MiB, https only; 10 writes a minute per user and IP;
  - **party-lookup timing:** a party card for a user with an avatar costs 1–2 more queries than a miss, because
    signing reads the file record. That is a small "has an avatar" timing signal under §17. Is it acceptable, or
    should files get a purely local signer for PUBLIC files?
  - provider import returns SKIPPED until T-034 wires `fetchImage` and `ingest`. The contract they must pass is
    in `apps/backend-api/test/support/fetch-image-contract.ts`.
- **T-052 KYC review defaults** (not merged; the branch still needs its fixer; listed in
  `docs/superpowers/plans/2026-11-09-t-052-kyc-review-queue.md` on `t-052-kyc-review-queue`):
  - clearing a duplicate flag needs a dual-approved `VERIFICATION_OVERRIDE`; confirming needs only
    `duplicate_flag.resolve`. A release drops the first account to level 1 (NIN/BVN) or level 2 (CAC);
  - a level override grants only level 2 or 3, never 4, and revokes to level 1 at the lowest;
  - the repeated-rejection event fires when a user's rejections in a rolling 30 days, across all types, reach
    exactly 2;
  - approving a FUZZY bank match approves the request but doesn't grant level 3;
  - duplicate cases are HIGH priority, all others NORMAL.
- **T-029 infra isolation: needs a go-ahead to edit `docker-compose.yml`.** The last open flake is
  Postgres connection exhaustion (12 parallel test databases × PgBouncer pool 20 against
  `max_connections` 100). The proposed fix: Postgres `max_connections=300`; PgBouncer
  `DEFAULT_POOL_SIZE: 10`, `MAX_DB_CONNECTIONS: 15`, `SERVER_LOGIN_RETRY: 0`. It's a shared-resource
  file, so the manager won't change it without your go-ahead. The worktree `t-029-infra-isolation`
  has no unmerged commits.
- **T-107 case defaults** (merged 2026-11-07; all 16 are in `docs/superpowers/plans/2026-11-07-t-107-cases.md`):
  - **Which roles may own and decide cases?** Today only `cases.manage` holders can: SUPER_ADMIN,
    OPERATIONS_ADMIN and PARK_OPERATIONS. COMPLIANCE_OFFICER, FRAUD_ANALYST and KYC_ANALYST can only
    view cases, so an escalation that needs an expert decision can't reach an expert.
  - SLA hours: DISPUTE 48, KYB 72, MERCHANT_APPLICATION 72, IDENTITY 24, FRAUD 24, CUSTODY 48,
    PAYMENT_EXCEPTION 24, TRADE_PROPOSAL 24, PARK_HUB_APPLICATION 120. "At risk" means the last 25% of the
    window, or past it. The clock keeps running while a case awaits evidence.
  - Any manager may reassign a case to themselves; a reason is required. Only the case's owner may decide it.
  - The policy citation is free text until a policy registry exists.
- **T-039 account-lifecycle defaults** (merged 2026-11-07; all 18 are in
  `docs/superpowers/plans/2026-11-07-t-039-account-lifecycle.md`). The ones most worth a look:
  - Suspended, locked and closed users have no session, so the AS1/AS2 notice comes back in the login 403
    (notice key, support reference, abilities; never the staff reason). It has no `openTrades` count.
    Does AS2 need it?
  - Any non-terminal trade blocks closing. Self-close is allowed from ACTIVE, PENDING_VERIFICATION and
    RESTRICTED. Is a staff-assisted close or erasure needed for SUSPENDED and LOCKED accounts?
  - Every recovery request needs a human reviewer (threshold 0), and the reviewer reuses `user.reinstate`.
    Approval only unlocks and signs out. The public route takes no evidence uploads.
  - Erasure closes the account at once. Anonymisation isn't scheduled; T-104 must call it.
  - Lock is system-only, and anonymising a staff member is refused.
- **T-141 work-queue defaults** (merged 2026-11-07; listed in `docs/superpowers/plans/2026-11-07-t-141-work-queue.md`):
  - the orient screens are tabs under `/queue`, not top-level routes;
  - the case-type-to-area mapping, and the P1 "flagged" and "cleared today" definitions;
  - Trade 360 finds a trade's cases by `subjectType` TRADE with the trade reference as `subjectId`;
  - staff can only reassign a case to themselves until a roster read exists;
  - queues refresh by polling every 60 s.
  - Backend gaps it exposed: `GET /admin/me`, a staff roster, queue aggregates, a staff trade read model and an
    alert inbox. No module calls `registerCase` yet, so the queues stay empty against a real backend.
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

## 2026-11-06 18:40–19:40 WAT — T-048 and T-222 in parallel (interactive, outside the schedule)

- Usage at start: 5h 48%, week 43%. At end: 5h 68%, week 45%.
- Pairing:
  - T-038 and T-048 could not run together, because both add migrations.
  - T-072 (money, Opus throughout) was held for a fresh window.
  - So the run paired T-048 (critical path) with T-222 (UI, no migration).
- **T-222: merged.**
  - The tab bar is re-based on v2's `.komtru-mobile-nav`.
  - The manager corrected the ticket text: v2's final cascade renders 9.5px labels, not 10px.
  - The manager reviewed the diff itself instead of running a reviewer agent; it is a small UI
    change.
  - Verified: ui-kit 850/850; lint and types clean.
- **T-048: merged.**
  - Config module: settings, flags, an append-only change log, a cached typed accessor and admin
    endpoints. Migrations 0032 and 0033.
  - The Sonnet review found 3 must-fixes and 6 should-fixes, all fixed. The must-fixes:
    - the fee guard missed concatenated words such as `platformfee`;
    - the DENIED audit row was unproven;
    - the event subscribers were untested.
  - Verified after merging main: 1,615 config and identity tests with infrastructure; migration
    safety 34/0 errors; lint and types clean. Main typechecks after the merge.
  - The §6 content proxies wait for M10, M11 and M13.
- Ticket costs:
  - T-222 (build plus one fix): about 5h 4, week 0.5.
  - T-048 (build, review, fix): about 5h 16, week 2.
- Next: T-072 funding (Opus) in a fresh window. Then T-038 staff invitations, T-049 trade
  standards (critical path, now unblocked by T-048), and T-039.

## 2026-11-06 19:40–21:10 WAT — T-049 and T-038 in parallel (interactive, outside the schedule)

- Usage at start: 5h 68%, week 45%. At end: 5h 85%, week 47%.
- Migration sequencing: T-049 owned the run's migration (0034). T-038 built everything except its
  table migration and stopped at "ready for migration", so the two could not collide.
- **T-049: merged.**
  - Trade standards with immutable versions, ETag-cached current reads, and the BEI1 rule (lengthen
    only, capped). Migration 0034.
  - The review found no must-fix; 7 should-fix items were fixed, including error responses being
    publicly cached and a stale "current" read.
  - Verified after merging main: 119/119 config tests; migrations 35/0 errors; lint and types clean.
- **T-038: saved before its migration.** Branch `t-038-staff-invitations`; the ticket's status line
  lists the 4 remaining steps.
  - The 5-hour window was at 85%, so the manager did not start the migration and integration-test
    phase.
- **Also fixed on main:** the CI PgBouncer settings now match docker compose. b61667c had changed
  only compose, which failed `ci-workflows.test.ts`. All 263 repo tests pass.
- Ticket costs:
  - T-049 (build, review, fix): about 5h 11, week 1.5.
  - T-038 so far: about 5h 5.
- Next: finish T-038 (resume the worktree), then T-072 funding (Opus, in a fresh window), then
  T-039 and T-046.

## 2026-11-06 21:30 WAT — skipped: budget (5h 89%, week 48%)

- Capacity 0: the 5-hour window (89%, resets 22:20 WAT) leaves no room for a ticket cycle.
- In-flight, not a cheap tail, so not resumed: `t-038-staff-invitations` (migration and
  integration tests left) and `t-029-infra-isolation`.
- Next: finish T-038 from its worktree, then T-072 funding (Opus), then T-039 and T-046.

## 2026-11-06 23:02 WAT — run summary (interactive, owner picked T-038 + T-046)

- Usage at start: 5h 9%, week 49%. At end: 5h 36%, week 53%.
- Capacity: 2. Tickets: T-038 (merged), T-046 (merged).
  - T-038 added migration 0035. Review: 0 must-fix, 7 should-fix items, all fixed, including
    acceptance OTPs bound to the invitation, a partial unique index on pending invites, and an
    active-inviter check.
  - T-046 waited for T-038 to merge, then added migrations 0036 and 0037 (geo catalog, no-delete
    trigger). Review: 1 must-fix (the decision sweep missed requests made during a decision, so
    their notifications were lost) and 6 should-fix items, all fixed.
- Ticket costs, for the two together: 5h-cost=27 week-cost=4, so about 14 and 2 each.
- Next: T-072 funding (opus) in a fresh window, or T-107 and T-039. The lock is released, so
  the 00:07 scheduled run can start.

## 2026-11-07 00:08 WAT — run summary (interactive, owner asked for two cheap non-funding tickets)

- Usage at start: 5h 36%, week 53%. At end: 5h 73%, week 58%.
- Capacity: 2. Tickets: T-042 (merged), T-140 (merged).
  - T-042 added migration 0038 `identity_addresses`, with a no-delete trigger. Review: 0
    must-fix, 6 should-fix items fixed. Geo is now injected as a `CityLookup` port, and
    `anonymiseUserAddresses` is ready for T-039.
  - T-140: the operations-app Next.js console, staff sign-in plus MFA, invitation acceptance,
    and a sidebar filtered by permission. No migration. Review: 4 must-fix items, all fixed:
    the invitation flow told users to turn MFA off, the sign-in proxy was open, the consumer
    session was never revoked, and the auth POSTs had no CSRF check. 2 should-fix items also
    fixed.
- Ticket costs, together: 5h-cost=37 week-cost=5. T-140 cost most, because of its security fix
  round.
- Follow-ups T-140 needs from the backend:
  - `GET /admin/me`, for roles and permissions. The sidebar stays empty until it exists.
  - Staff-scoped MFA routes.
  - The auth rate limiter moved to Redis.
  - Setting `TRUST_PROXY_HOPS` at deploy time.
- Next: T-072 funding (opus) needs a fresh window. It is not worth starting at 73%. T-107 and
  T-039 are next for a fresh window too.

## 2026-11-07 00:13 WAT — run summary

- Usage at start: 5h 73%, week 58%. At end: 5h 85%, week 59%.
- Capacity: 1 (`est` 14: 73+14 ≤ 90, but 73+28 > 90). Tickets: T-061 (saved at implement).
  - T-061 proposal flow, on the critical path. Sonnet implementer: 5 commits on
    `t-061-proposal-flow`, migration 0039 (`trade_proof_media`, nullable terms addresses).
    Backend unit tests 3047/3047 and trades infra tests 289/289 pass, and format and migration
    safety are clean. Not reviewed: the window was at 85% after implementation, too close to
    the 88% stop for a review and fix round plus the run close.
  - Not resumed: `t-029-infra-isolation`. Its branch has no commits beyond an old `main`, and
    it needs 20 full infra-suite runs, so it is not a cheap tail.
- Ticket costs: T-061 implement only, 5h-cost=12 week-cost=1.
- Next: T-061 review, then fix and merge, in a fresh window. The reviewer should check that
  `trades.payment_deadline_hours` (T-048) is not yet applied at acceptance. Then T-072 funding
  (opus), T-107 and T-039.

## 2026-11-07 03:13 WAT — skipped: budget (5h 87%, week 59%)

- Capacity 0: `est` 14, and 87+14 > 90. The 5-hour window resets at 03:20 WAT.
- In-flight, not a cheap tail, so not resumed: `t-061-proposal-flow` (review, fix and merge
  left) and `t-029-infra-isolation`.
- Next: T-061 review, fix and merge, then T-072 funding (opus), T-107 and T-039.

## 2026-11-07 06:16 WAT — run summary

- Usage at start: 5h 1%, week 60%. At end: 5h 56%, week 67%.
- Capacity: 2 (`est` 14). Tickets: T-061 (merged), T-072 (saved at fix, awaiting the owner's fee decision).
  - T-061: Sonnet review gave 2 must-fix items (proof access was never granted on claim or on a send
    retry) and 8 should-fix items. A fresh Sonnet fixer fixed all 10, including concurrency tests and an
    "at least one address" check in migration 0039. Merged; 3048 backend tests green on `main`, and
    migration safety is clean.
  - T-072 (Opus): it first stopped, as told, because `payment_attempts` and `payment_provider_webhooks` did
    not exist. After T-061 merged it took migration 0040 and built initiate, confirm and status, the
    Paystack webhook, and the verify job. Sonnet review: 4 must-fix items (the Inline amount could drift
    from the attempt, confirm and restart raced the settle, a buyer could be locked out, and review events
    were duplicated) and 6 should-fix items, all fixed. 3121 unit and 359 ledger infra tests green. Not
    merged: the fee-liability placement is a money rule for the owner.
- Ticket costs: T-061 (review+fix) 5h-cost=21 week-cost=2; T-072 5h-cost=34 week-cost=5.
- Not resumed: `t-029-infra-isolation` (cross-cutting, so it can't run alongside other work, and it's not a
  cheap tail).
- Next: merge T-072 once the owner answers the fee question (rebase onto `main`, re-run checks). Otherwise
  T-107 and T-039, or T-029 on its own.

## 2026-11-07 10:57 WAT — run summary

- Usage at start: 5h 56%, week 67%. At end: 5h 74%, week 69%.
- Capacity: 1. `est` 19 (median of the last 5 completed tickets), and 56 + 2×19 > 90. Tickets: T-107 (merged).
  - T-107: Sonnet implemented `src/modules/cases/**` with migrations 0040 and 0041. Sonnet review gave 2
    must-fix items (a cursor of the wrong shape silently restarted at page 1, and expert roles can never
    own or decide a case) and 7 should-fix items. The fixer fixed all 9; the role question went to the
    owner, with the RBAC catalogue unchanged. The first full run on `main` failed 3 identity MFA tests on
    timeouts, which is the known T-029 load flake. Those files passed on their own, and a second full run
    was green: 244 files, 4478 tests. Migration safety reports 0 errors.
- Ticket costs: T-107 5h-cost=18 week-cost=2.
- Not resumed: `t-072-funding` (waiting on the fee question) and `t-029-infra-isolation` (waiting on the
  docker-compose go-ahead; it has no unmerged commits).
- Note for T-072: T-107 took migrations 0040 and 0041. The T-072 merge must renumber its migration to 0042.
- Next: T-039 (account lifecycle). T-072 once the fee question is answered; T-029 once the compose change is
  approved.

## 2026-11-07 13:03 WAT — run summary

- Usage at start: 5h 1%, week 69%. At end: 5h 45%, week 75%.
- Capacity: 2 (`est` 19: 1 + 2×19 ≤ 90; week 69 + 2 ≤ 85). Tickets: T-141 (merged), T-039 (merged).
  - T-141 (Sonnet, operations-app and api-client, no migration): the work queue, universal case page,
    Trade 360 cases view and the mobile proposal check-in. Sonnet review: 2 must-fix items (a footnote
    promised "both parties are told", and every failure showed the same retry text) and 8 should-fix items,
    all fixed. 151 operations-app and 159 api-client tests are green on `main`. `main` first failed because
    its `node_modules` lacked the operations-app dependencies; `pnpm install` fixed that.
  - T-039 (Sonnet, identity, no migration): the status machine, close guard, recovery with human review,
    export and erasure events, and §15 anonymisation. Sonnet review: 4 must-fix items (close raced trade
    creation, so trade creation now takes `FOR SHARE` on the party rows; the suspension notice couldn't be
    reached; anonymisation left PII behind; the recovery receipt revealed whether an account exists) and 9
    should-fix items, all fixed. Two full infra-on runs on `main` each failed one different
    test (`verification.int`, then `processes.int`). Both files pass on their own and T-039 touched
    neither, so this is the known T-029 load flake. 4547 of 4548 tests passed.
- Subagents could not change directory into the manager's `t-0xx` worktrees and committed on their own
  `worktree-agent-*` branches instead. The manager fast-forwarded the ticket branches from those branches.
- Ticket costs, together: 5h-cost=44 week-cost=6, so about 22 and 3 each.
- Not resumed: `t-072-funding` (waiting on the fee question) and `t-029-infra-isolation` (waiting on the
  docker-compose go-ahead).
- Next: T-052 (KYC review queue; trust module, now that T-107 is in). T-072 once the fee question is
  answered; T-029 once the compose change is approved.

## 2026-11-09 13:13 WAT — run summary

- Usage at start: 5h 1%, week 76%. At end: 5h 59%, week 84%.
- The stale lock from 2026-11-07 12:12Z (older than 4 hours) was replaced.
- Capacity: 2 (`est` 22, `est_week` 3: 1 + 2×22 ≤ 90; 76 + 2×3 ≤ 85). T-052 was the only unblocked Ready MVP
  ticket; T-041 (identity, no migration) ran alongside it. Tickets: T-041 (merged), T-052 (saved at review).
  - T-041 (Sonnet): `POST`/`DELETE /me/avatar`, signed URLs at read time, and a provider-import path behind
    ports. Sonnet review: 1 must-fix item (party cards never got `avatarUrl`; `enrich` is now wired, with
    decoy signing on a miss) and 9 should-fix items (the swap race, `onlyIfNone` under the lock, orphan cleanup,
    magic-byte sniffing, the `fetchImage` SSRF contract for T-034, concurrency tests), all fixed. On `main`
    with infra: backend-api 256 files and 4613 tests, shared-types 192, api-client 161, all green; format is clean.
  - T-052 (Sonnet): migration 0042 `trust.duplicate_identity_flags`, the `/admin/kyc` queue, duplicate flags,
    dual-approved overrides and the repeated-rejection event. 4585 infra tests green on the branch. Sonnet review: 3 must-fix
    items (a racy 30-day counter; a duplicate with a null `firstUserId` gets a case but no flag, so it can be
    decided through the plain queue; missing concurrency and approval-replay tests) and 8 should-fix items. The
    fixer was not started: weekly usage was 83% with the T-041 fix still running, and the fix phase would have
    reached the 85% reserve. The review items are in the plan on the branch (commit `eb584f1`).
- Ticket costs, together: 5h-cost=58 week-cost=8, about 29 and 4 each. Both implementers ran with
  infra tests on the shared Postgres; they collided on `komtru_test_*` names until T-052 set
  `KOMTRU_TEST_DB_PREFIX`. Tell parallel implementers to set distinct prefixes.
- Not touched: `t-072-funding` (fee question), `t-029-infra-isolation` (compose go-ahead), and a new
  `t-111-entry-auth` worktree this run did not create (the owner's or another session's).
- `main` has uncommitted owner work (populate-frontend-env scripts, package.json, turbo.json, README); it was
  left untouched and not committed.
- Next: resume T-052 with a fixer (on `t-052-kyc-review-queue`), then merge it. The weekly limit resets
  2026-11-10 15:00 WAT; until then the 85% reserve leaves no room for a ticket cycle.

## 2026-11-09 17:5x WAT — run summary (interactive, owner directed)

- Usage: not measured. `get_usage` was unavailable in this session, so the budget gate in MANAGER.md
  step 0 could not run. The owner directed the work, and the weekly reserve is theirs to spend.
- Committed the owner's uncommitted work on `main` as five commits: the `POSTGRES_CA_CERT` bundle for
  Postgres TLS (`platform/postgres-ssl.ts`, used by the pool, migrator, seeder and bootstrap script),
  the backend env generator setting this monorepo's own topology instead of inheriting the old
  stack's ports and origins, `pnpm env:apps` for the four frontend `.env.local` files, turbo `dev`
  and `dev:worker` tasks behind `pnpm dev`, and the README and runbook for all of it. Verified first:
  293 repo tests, 5 new postgres-ssl tests, `format:check`, forced lint and typecheck on backend-api.
- Tickets: T-052 (merged), T-072 (merged).
  - T-052 (Sonnet fixer): all 11 review items fixed in one commit. The 30-day repeated-rejection
    counter now takes `pg_advisory_xact_lock(hashtext('trust:rejections:'||userId))` before counting,
    proven by removing the lock and watching the new concurrency test fail with 0 events. A case whose
    fact says `duplicateIdentity` but carries no flag is refused 409 instead of being decidable through
    the plain queue without dual approval. `consumeApproval` runs first in the CLEARED branch; an
    escalation can no longer be resolved by its escalator; erasure scrubs flag hashes through a new
    `identity.account.anonymised` subscriber. On `main`: 3141 unit tests, format clean, migration
    safety 43 migrations / 115 invariants / 0 errors.
  - T-072 (Opus): the owner settled decision 1 — the buyer protection fee gets its own account.
    `BUYER_PROTECTION_FEE_LIABILITY`, credit-normal, scoped by trade. Funding posts three lines, so
    the trade's escrow liability balance is exactly the refundable item money and no service has to
    subtract the T-047 snapshot. Two real defects found in the obvious migration: `ALTER TYPE … ADD
VALUE` cannot work here at all (drizzle runs every pending migration in one transaction and a new
    label is unusable in the transaction that adds it, so splitting across files does not help) —
    `0044` rebuilds the type instead; and `drizzle-kit generate` silently drops
    `ledger_accounts_key_unique` with the generated column, which would have left `ON CONFLICT
(account_key)` with no arbiter and let two codepaths create separate accounts for one trade's
    money without the balance invariant noticing. Branch verification: 264 files, 4824 tests, 0
    failures; migration safety 45 migrations / 128 invariants / 0 errors, including the `forward`
    check applying main-with-T-052 then 0043 and 0044 on top.
- Migration numbering cost this branch two renumbers: it was cut before T-107, and T-052 took 0042
  while T-072 was in flight. Final: T-052 `0042_trust_duplicate_flags`, T-072 `0043_ledger_payments`
  and `0044_ledger_fee_liability_account`. A renumber is never a `git mv` — `journal-complete`
  contiguity, `snapshot-chain` prevId and `journal-order` timestamps all have to move with it, and
  the snapshots must be regenerated rather than renamed.
- Verification gap, stated plainly: lint, typecheck and the 3218-test unit run are green on `main`
  after both merges, and `migration:safety` is clean, but the full `KOMTRU_INFRA_TESTS=1` suite was
  run on each branch, not on merged `main` — the owner stopped that run for time. Both merges were
  conflict-free in source (only journal, snapshot and lock bookkeeping conflicted), so the risk is
  low, but a full infra run on `main` is the first thing the next run should do.
- Cleanup: removed all four worktrees and deleted eleven branches — nine already merged into `main`
  (`t-029-infra-isolation` a862157, `t-038-staff-invitations` 9b35ee7, `t-041-avatars` c02142b,
  `t-042-saved-addresses` a0bbedb, `t-046-location-catalog` 151a605, `t-061-proposal-flow` f0b8e8d,
  `t-107-cases` 1c9a4ed, `t-111-email-otp-fallback` b7cbd57, `t-140-console-scaffold` 7f5abf8), plus
  `wip/main-uncommitted-2026-10-15` f5bc7c4 (all four of its tickets are Done, the condition
  MANAGER.md set for deleting it) and the two merged ticket branches. Those SHAs are here so anything
  needed is recoverable from the reflog. MANAGER.md lost its two stale reconcile bullets. No stashes,
  nothing prunable, clean tree.
- T-029 was never in-flight: its worktree was empty and its branch already an ancestor of `main`. Its
  status line is accurate — the namespacing and `eventually` diagnostic are merged, and the remainder
  is still blocked on the owner's docker-compose go-ahead (12 parallel test databases at pool size 20
  ask for up to 240 connections against `max_connections` 100, surfacing as a misleading
  `password authentication failed`).
- Open for the owner: the T-052 items (the resolution rule for a flag-less duplicate; whether "senior"
  should stay SUPER_ADMIN/COMPLIANCE_OFFICER when `duplicate_flag.resolve` is granted only to
  KYC_ANALYST; and that T-039 anonymisation still does not scrub `nin_verifications`/`bvn_verifications`
  hashes, which wants its own ticket), and the T-029 compose change.
- Next: a full infra run on `main`, then T-029 once the compose change is approved. T-072 unblocked
  T-064, T-073, T-074 and T-075, so the ledger critical path is open.
