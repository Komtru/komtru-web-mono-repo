# Komtru — feature map

**Written 2026-11-09.** This document replaces the layer epics as the unit of work. It does not
rewrite `docs/tickets/00-foundations.md` … `18-ui-master-v2.md`; it maps every one of their 168
tickets onto a feature, so the existing files stay valid as the detailed specification and the
T- ids keep working as references from git history, `docs/superpowers/plans/*.md` and
`docs/manager/RUN_LOG.md`.

## What changed and why

**The plan was split by layer, and the layers drifted apart.** Epics 00–12 are backend and
epics 13–18 are frontend. Nothing in that structure required the two halves to meet, so they
did not: 51 of the 58 finished tickets sit in epics 00–12 and only 7 in epics 13–18. A trade can today be proposed, funded,
shipped, inspected and settled over HTTP, while the consumer app renders AC1 — the screen that
says _"Your trades will appear here"_. The backend ran 58 tickets ahead of the UI because the
plan let it, and the progress number said 52% the whole way.

**The new unit is a feature, and the spine is the user journey.** A feature is a thing a
person can do — "Fund escrow", "Ship an item", "Open a dispute" — and it carries its backend
and its frontend together. The journeys are the ones the UI Living Master v2 already uses for
its desktop and tablet sections (Arrive & verify, Home, Discover, Propose & agree, Fund &
protect, Fulfil & dispatch, Deliver & inspect, Issues & resolution, Complete & grow), plus the
surfaces v2 draws separately: the merchant storefront, the account area, the TrustOps console,
the Park hub and the logistics partner portal. A feature is **Done** only when both ends are
done. There is no status for "the API works".

**Finished work is preserved, not discarded.** Every feature lists the T- ids it absorbs and
marks each `(done)` or `(todo)`, and each feature's backend scope says _already built_ where
that is true. Six features read **Backend done, UI outstanding** — F-024 Fund escrow, F-026
Accept, prove, prepare and ship, F-027 Confirm delivery and inspect, F-044 Account basics,
F-045 Verify yourself, F-051 Review identity and KYC. That is exactly the drift made visible:
the money, fulfilment, inspection and KYC engines are finished and unreachable. Thirteen
features are genuinely **Done**, because their screens shipped too.

**The numbers get worse on purpose.** Under the ticket count the build read 58/112 MVP (52%)
and 58/168 overall (35%). Under features it reads **13/51 MVP (25%)** and **13/79 overall
(16%)**. Nothing regressed; the old number counted layers and the new one counts things a user
can do. Twenty-five per cent is the honest reading of a product whose consumer app cannot yet
list a trade.

### How to read a feature

- **Absorbs** is load-bearing. Every T- id appears in exactly one feature's list, verified
  mechanically in [the verification section](#4-verification).
- **Depends on** lists _outstanding_ work only. A dependency already satisfied by a done ticket
  is not repeated, because it does not block anything. The graph is acyclic; see verification.
- **T-190 is folded in, not depended on.** It is done, and it re-scoped every UI ticket onto
  Living Master v2. It is absorbed by F-010, and every frontend scope below already means v2.
  No feature restates a dependency on it.
- **MVP** is carried from `docs/MVP.md`'s current cut (shape C, escrow + merchant storefront).
  A feature is MVP if any ticket it absorbs is in that cut or is already done. Where an MVP
  feature's ticket graph reaches a deferred feature, `docs/MVP.md`'s dependency edits apply and
  the note says so.

## 1. Journeys

| Journey                                     | Features         | Why it is a journey                                                                                                                                                                                                                           |
| ------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Platform (not a user journey)**           | F-001–F-010 (10) | **Not a journey.** Infrastructure with no screen: toolchain, database, queues, crypto, the provider boundary, test isolation, the ledger core and the v2 screen remap. Grouped here rather than forced into a user story.                     |
| **Arrive & verify**                         | F-011–F-014 (4)  | Getting in at all: sign up, verify a phone, sign in, the shell you land in, the walkthrough.                                                                                                                                                  |
| **Home & discover**                         | F-015–F-016 (2)  | Finding something, or someone, to trade with.                                                                                                                                                                                                 |
| **Propose & agree**                         | F-017–F-021 (5)  | Turning an intention into an agreed trade. v2's four-stage Create a Trade lives here.                                                                                                                                                         |
| **The trade workspace**                     | F-022–F-023 (2)  | v2 replaced the separate buyer and seller trade screens with one role-aware tabbed workspace. Every later trade journey renders inside it, so it is its own band.                                                                             |
| **Fund & protect**                          | F-024–F-025 (2)  | Money into escrow.                                                                                                                                                                                                                            |
| **Fulfil & dispatch**                       | F-026 (1)        | The seller's half: prove, pack, ship.                                                                                                                                                                                                         |
| **Deliver & inspect**                       | F-027–F-029 (3)  | The buyer's half: receive, check, accept, release.                                                                                                                                                                                            |
| **Issues & resolution**                     | F-030–F-036 (7)  | When it goes wrong — cancel, refund, dispute, and execute a resolution. Includes the TrustOps decision screen, because a dispute is one journey with two ends.                                                                                |
| **Complete & grow**                         | F-037–F-039 (3)  | After the money moves: payouts, reviews, insights.                                                                                                                                                                                            |
| **Sell on Komtru**                          | F-040–F-043 (4)  | The merchant storefront: certification, listings, shop settings, customers.                                                                                                                                                                   |
| **Account, trust & support**                | F-044–F-048 (5)  | The Account tab and everything reached from it, plus messaging and help.                                                                                                                                                                      |
| **TrustOps console**                        | F-049–F-059 (11) | Staff work that has no consumer counterpart. Dispute decisions, identity review and merchant review are _not_ here — they sit in the journey they serve.                                                                                      |
| **Park network**                            | F-060–F-064 (5)  | The hub agent persona and the custody network. The signature feature, in the MVP since 2026-11-19.                                                                                                                                            |
| **Logistics partner**                       | F-065–F-066 (2)  | The partner portal and ship-to-company.                                                                                                                                                                                                       |
| **Desktop & tablet journeys**               | F-067–F-074 (8)  | v2 draws desktop and tablet as whole-journey layouts (Desktop · 01–11, Tablet · 01–11), not per-screen variants. Keeping that seam means the mobile journey ships first and the wide layouts follow, which is how the reference is organised. |
| **Launch & assurance (not a user journey)** | F-075–F-079 (5)  | **Not a journey.** Hosting, end-to-end suites, security review, load, and the final audit and first push.                                                                                                                                     |

## 2. The features

### Journey: Platform (not a user journey)

#### F-001 — Repo, toolchain and continuous integration

- **Journey:** Platform (not a user journey)
- **Actor:** platform
- **Absorbs:** T-001 (done), T-002 (done), T-003 (done), T-004 (done), T-006 (done)
- **Backend scope:** Monorepo, pnpm/turbo config, local Docker infra, five CI workflows and the build-agent tooling. Already built (T-001–T-004, T-006).
- **Frontend scope:** None. Infrastructure.
- **Status:** Done
- **Depends on:** none
- **MVP:** yes

#### F-002 — Shared design system, ui-kit and app foundations

- **Journey:** Platform (not a user journey)
- **Actor:** platform
- **Absorbs:** T-010 (done), T-011 (done), T-012 (done), T-013 (done), T-014 (done), T-015 (done), T-016 (done), T-017 (done)
- **Backend scope:** `shared-types` and `api-client`. Already built (T-010, T-015).
- **Frontend scope:** `ui-kit` tokens, primitives, layout shells and TrustOps patterns, the visual-check harness and the Next.js app foundation every frontend is built from. Already built (T-011–T-014, T-016, T-017).
- **Status:** Done
- **Depends on:** none
- **MVP:** yes
- **Note:** This is the only 'layer' feature that survives on purpose: it is a library, not a journey, and every UI feature consumes it.

#### F-003 — Backend skeleton, database, migrations, jobs and events

- **Journey:** Platform (not a user journey)
- **Actor:** platform
- **Absorbs:** T-020 (done), T-021 (done), T-022 (done), T-023 (done), T-024 (done)
- **Backend scope:** NestJS skeleton, Postgres/Drizzle foundation, the migration-safety CI gate, Redis/BullMQ scheduler and the outbox + typed event bus. Already built (T-020–T-024).
- **Frontend scope:** None. Infrastructure.
- **Status:** Done
- **Depends on:** none
- **MVP:** yes

#### F-004 — Backend cross-cutting: HTTP contract, crypto and the provider boundary

- **Journey:** Platform (not a user journey)
- **Actor:** platform
- **Absorbs:** T-025 (done), T-026 (done), T-028 (done)
- **Backend scope:** Pagination, idempotency keys, rate limits and request validation; platform crypto and identifiers; the outbound provider boundary with timeouts and circuit breakers. Already built (T-025, T-026, T-028).
- **Frontend scope:** None. Infrastructure.
- **Status:** Done
- **Depends on:** none
- **MVP:** yes

#### F-005 — Deterministic integration test suite

- **Journey:** Platform (not a user journey)
- **Actor:** platform
- **Absorbs:** T-029 (todo)
- **Backend scope:** Give the integration suite its own Redis database and queue prefixes so parallel runs stop colliding (T-029).
- **Frontend scope:** None. Infrastructure.
- **Status:** Not started
- **Progress note (2026-11-19):** Code merged to `staging`: T-029's cause 3 is fixed (the run id now appears in worker **and template** database names), with run-scoped teardown, a per-worker BullMQ prefix for `startScheduler`, and `eventually()` diagnostics. **Not Done:** the 20-run criterion moved to CI (`.github/workflows/backend-infra-soak.yml`, dispatch-only) and **has never been run**. Locally it reached 6 consecutive green runs before an external SIGTERM under load average 68 — not a test failure. Two caveats in the ticket: a `workflow_dispatch` workflow is only dispatchable once it reaches the default branch `main`, and CI's Postgres runs at the image default of 100 connections because a service container cannot take compose's `command`.
- **Depends on:** none
- **MVP:** yes
- **Note:** No screen, and never will have one. It is on the MVP list because a flaky suite blocks every other feature's verification.

#### F-006 — Platform configuration and the fee schedule

- **Journey:** Platform (not a user journey)
- **Actor:** platform
- **Absorbs:** T-047 (done), T-048 (done)
- **Backend scope:** The fee schedule file and the configuration module with staff-editable values. Already built (T-047, T-048).
- **Frontend scope:** None of its own; the TrustOps configuration screens that edit it are F-056.
- **Status:** Done
- **Depends on:** none
- **MVP:** yes

#### F-007 — Notification delivery and the realtime transport

- **Journey:** Platform (not a user journey)
- **Actor:** platform
- **Absorbs:** T-045 (done), T-027 (done)
- **Backend scope:** Notification delivery pipeline (M11) and the authenticated socket gateway. Already built (T-045, T-027).
- **Frontend scope:** None of its own; notification preferences are F-046, and in-trade realtime is F-022.
- **Status:** Done
- **Depends on:** none
- **MVP:** yes

#### F-008 — Media and evidence storage

- **Journey:** Platform (not a user journey)
- **Actor:** platform
- **Absorbs:** T-040 (done), T-041 (done)
- **Backend scope:** Files and evidence uploads with client-direct Cloudinary, rotation and pools; avatar ingest. Already built (T-040, T-041).
- **Frontend scope:** None of its own; every upload and gallery surface (proof media, dispute evidence, KYC) is drawn by the feature that uses it.
- **Status:** Done
- **Depends on:** none
- **MVP:** yes

#### F-009 — Double-entry ledger core and the payment provider adapter

- **Journey:** Platform (not a user journey)
- **Actor:** platform
- **Absorbs:** T-070 (done), T-071 (done)
- **Backend scope:** Double-entry ledger with immutable postings, and the provider adapter with Paystack. Already built (T-070, T-071).
- **Frontend scope:** None. There is no screen for the ledger and there should not be.
- **Status:** Done
- **Depends on:** none
- **MVP:** yes
- **Note:** Kept out of the money journeys deliberately: it is the invariant everything else is checked against.

#### F-010 — Screen index remap to UI Living Master v2

- **Journey:** Platform (not a user journey)
- **Actor:** platform
- **Absorbs:** T-190 (done)
- **Backend scope:** None.
- **Frontend scope:** Remapped all 437 v2 screens onto tickets and re-scoped every undone UI ticket to Living Master v2 (T-190). Already done.
- **Status:** Done
- **Depends on:** none
- **MVP:** yes
- **Note:** Absorbed here rather than left as a dependency edge. Every frontend scope in this document already means v2; no feature restates a dependency on T-190.

### Journey: Arrive & verify

#### F-011 — Sign up, verify a phone, sign in and secure the device

- **Journey:** Arrive & verify
- **Actor:** buyer, seller
- **Absorbs:** T-030 (done), T-031 (done), T-032 (done), T-033 (done), T-036 (done), T-111 (done)
- **Backend scope:** Identity schema, sessions and principal resolution, registration/OTP/password login, usernames, and devices, MFA and passkeys. Already built (T-030–T-033, T-036).
- **Frontend scope:** Entry — Mobile Web (E1–E4, E3b), Terms & Privacy acceptance (TOS1, TOS2) and password reset (AC2, AC3). Built (T-111). _9 v2 screens._
- **Status:** Done
- **Depends on:** none
- **MVP:** yes
- **Note:** Done for email, phone and handle. Social sign-in is F-014 and was deliberately left out of T-111.

#### F-012 — App shell and navigation

- **Journey:** Arrive & verify
- **Actor:** buyer, seller
- **Absorbs:** T-110 (done), T-191 (done), T-222 (done)
- **Backend scope:** None.
- **Frontend scope:** App scaffold, the v2 desktop sidebar, tablet top nav, the offline screen (OF1) and the v2 mobile TabBar. Built (T-110, T-191, T-222). _2 v2 screens._
- **Status:** Done
- **Depends on:** none
- **MVP:** yes
- **Note:** The shell every other consumer feature renders inside. **Amended 2026-11-20 by the owner:**
  the Buy/Sell mode switch (Y2) and its Sell-mode tabs (Shop, Orders, Listings) are removed. There are
  no buyer and seller accounts; anyone buys and sells, and the side is chosen per trade on Start Trade
  (F-082). Design `docs/superpowers/specs/2026-11-20-one-account-trade-sides-design.md`.

#### F-013 — First-time onboarding walkthrough

- **Journey:** Arrive & verify
- **Actor:** buyer, seller
- **Absorbs:** T-112 (todo)
- **Backend scope:** None — uses the notification opt-in from F-007.
- **Frontend scope:** First-Time Onboarding Walkthrough, OB1–OB5. _5 v2 screens._
- **Status:** Done
- **Depends on:** none
- **MVP:** yes

#### F-014 — Sign in with Google, Apple or Facebook

- **Journey:** Arrive & verify
- **Actor:** buyer, seller
- **Absorbs:** T-034 (todo)
- **Backend scope:** Google, Apple and Facebook OAuth with PKCE, the §7.4 linking decision tree, and JWKS caching (T-034).
- **Frontend scope:** The social buttons on E1, E2 and E4 plus the OAuth callback screen — T-034 owns them, since T-111 shipped without them (owner decision 2026-11-09).
- **Status:** Not started
- **Depends on:** none
- **MVP:** no
- **Note:** Deferred. The only feature that adds UI to an already-Done screen set.

### Journey: Home & discover

#### F-015 — Home, trade search and find-a-trade-by-code

- **Journey:** Home & discover
- **Actor:** buyer
- **Absorbs:** T-113 (done)
- **Backend scope:** None new. `GET /trades` and `GET /trades/by-code/:code` already ship in the trades module. The M19 listing index (T-057) is deferred with the catalogue.
- **Frontend scope:** Home — Mobile Web and its additional states (Z1, H-01–H-03, Customer-1, AC1 empty state), trade search (SE1, SE2) and Find a Trade by code (F1, F2). Browse Categories (K1, K2) is deferred with the catalogue. _10 v2 screens._
- **Status:** Done
- **Depends on:** none
- **MVP:** yes
- **Note:** The screen the owner's complaint is about: AC1 is the 'Your trades will appear here' placeholder.
  **Rescoped 2026-11-15 by the owner:** home lists the user's own trades — past, and pending their
  acceptance — and search covers trades only. That drops T-057 and the F-041 dependency, so this
  feature is Ready now and needs no new backend.

#### F-016 — View a seller's profile and Trust Passport

- **Journey:** Home & discover
- **Actor:** buyer
- **Absorbs:** T-114 (todo), T-102 (todo)
- **Backend scope:** Reputation and ratings (M12) — score inputs, decay and the `reputation.score_changed` event F-015's ranking already reads (T-102).
- **Frontend scope:** Seller / Business Discovery Profile (I1, I2, I4) and the buyer's trust tab (Customer-6). _4 v2 screens._
- **Status:** Not started
- **Depends on:** F-015, F-032
- **MVP:** yes

### Journey: Propose & agree

#### F-017 — Propose a trade, invite the other party and order multiple items

- **Journey:** Propose & agree
- **Actor:** buyer, seller
- **Absorbs:** T-060 (done), T-061 (done), T-035 (done), T-049 (done), T-115 (todo)
- **Backend scope:** Trade schema, state machine and audit; the proposal flow; party lookup and invitations; Trade Standards by category. **Already built in full** (T-060, T-061, T-035, T-049). Multi-item ordering moved to F-080.
- **Frontend scope:** Create and propose a trade: seller pick (I3), Trade Standards (CTS1), proposal follow-through (Q1, R1), held-for-review (IF1), agreement (TC-05, TC-06), invite (G3), buyer tab (Customer-2), plus the IMEI entry points MI1, MI2 gated off until F-020. _12 v2 screens._
- **Status:** Done
- **Depends on:** F-020 _(post-MVP)_, F-021 _(MVP since 2026-11-19; adds the risk hold to this shipped flow)_ — **nothing blocking**
- **MVP:** yes
- **Note:** T-115's dependencies on IMEI (F-020) and the risk hold (F-021) are dropped for MVP, per docs/MVP.md. **Amended 2026-11-09:** multi-item ordering (T-063) was split out to F-080. T-063 depends on listings (T-056), so folding it in here made the whole buyer/seller trade arc wait on the merchant storefront — F-037 → F-040 → F-041 → F-017 — when a single-item trade needs no listings at all. Splitting it moves this feature from tier 4 to tier 1 and pulls the trade workspace forward with it.

#### F-018 — Create a trade: buyer starts, seller completes

- **Journey:** Propose & agree
- **Actor:** buyer
- **Absorbs:** T-192 (done)
- **Backend scope:** Served by F-017.
- **Frontend scope:** Create a Trade · Buyer starts (CT-B1–CT-B6) and Seller completes (CT-B7–CT-B10, CT-B2P, CT-B8P) — stages 1 and 2 of the v2 four-stage model. _12 v2 screens._
- **Status:** Done
- **Depends on:** F-017
- **MVP:** yes

#### F-019 — Create a trade: seller starts, buyer completes

- **Journey:** Propose & agree
- **Actor:** seller
- **Absorbs:** T-193 (done)
- **Backend scope:** Served by F-017.
- **Frontend scope:** Create a Trade · Seller starts (CT-S1–CT-S6) and Buyer completes (CT-S7, CT-S2F) — stages 3 and 4 of the four-stage model. _8 v2 screens._
- **Status:** Done
- **Depends on:** F-017, F-018
- **MVP:** yes
- **Note:** Split from F-018 at the four-stage seam: 20 screens in one ticket is two cycles, and the seller-start flow reuses the buyer-start components.

#### F-020 — Verify a phone IMEI before proposing

- **Journey:** Propose & agree
- **Actor:** buyer, seller
- **Absorbs:** T-067 (todo)
- **Backend scope:** IMEI verification against the provider boundary (T-067).
- **Frontend scope:** Unlocks MI1 and MI2, which F-017 draws but leaves disabled.
- **Status:** Not started
- **Depends on:** none
- **MVP:** no
- **Note:** Deferred. docs/MVP.md calls it 'the first thing to add back'.

#### F-021 — Hold a risky proposal for TrustOps review

- **Journey:** Propose & agree
- **Actor:** staff/TrustOps
- **Absorbs:** T-062 (todo), T-142 (todo)
- **Backend scope:** Proposal risk hold driven by the fraud signals of F-052 (T-062).
- **Frontend scope:** TrustOps · 03 · Proposals (OP-10, OP-11), and it turns on the IF1 held-for-review state F-017 already draws. _2 v2 screens._
- **Status:** Not started
- **Depends on:** F-052
- **MVP:** yes
- **Note:** **Brought into the MVP 2026-11-19 by the owner**, with Park, logistics and the core TrustOps console.

### Journey: The trade workspace

#### F-022 — Follow a trade in one role-aware workspace

- **Journey:** The trade workspace
- **Actor:** buyer, seller
- **Absorbs:** T-116 (todo), T-068 (todo)
- **Backend scope:** Trade realtime, notification fan-out and deep links over the F-007 socket gateway (T-068).
- **Frontend scope:** The canonical tabbed Trade Workspace — CWT-01–CWT-09 — plus the buyer's trades list and detail entry (Customer-3, Customer-5). _11 v2 screens._
- **Status:** Done
- **Depends on:** F-017
- **MVP:** yes
- **Note:** The spine screen. Every trade feature from here on renders a tab or a sheet inside it, which is why it is its own feature and comes before funding.

#### F-023 — Terms, agreement and payment detail in the workspace

- **Journey:** The trade workspace
- **Actor:** buyer, seller
- **Absorbs:** T-194 (todo)
- **Backend scope:** Served by F-017 and F-024.
- **Frontend scope:** Trade Workspace — Funding & Terms (TW-01–TW-04) and supporting sheets CWT-S01–CWT-S07 (terms, agreement, payment detail), plus the EX-01 lifecycle exception. _12 v2 screens._
- **Status:** Done
- **Depends on:** F-022
- **MVP:** yes

### Journey: Fund & protect

#### F-024 — Fund escrow

- **Journey:** Fund & protect
- **Actor:** buyer
- **Absorbs:** T-072 (done), T-117 (done)
- **Backend scope:** Funding a trade: escrow hold, the Buyer Protection Fee, pay-with-transfer and the funding state transitions. Already built (T-072).
- **Frontend scope:** Escrow Funding (V1, V2, V3) and its loading and failure states (AB3, AB4). _5 v2 screens._
- **Status:** Done
- **Depends on:** F-022
- **MVP:** yes
- **Note:** The clearest case of the problem this document fixes: money can be held in escrow over HTTP today and no one can pay it in.

#### F-025 — Top up and pay from a Komtru Wallet

- **Journey:** Fund & protect
- **Actor:** buyer
- **Absorbs:** T-077 (todo), T-131 (todo)
- **Backend scope:** Komtru Wallet top-up ledger accounts (T-077).
- **Frontend scope:** Wallet Top-Up (AB7) and the wallet statement (SP-M10). _2 v2 screens._
- **Status:** Not started
- **Depends on:** F-024
- **MVP:** no
- **Note:** Blocked on owner decision Q3 and deferred either way.

### Journey: Fulfil & dispatch

#### F-026 — Accept, prove, prepare and ship an item

- **Journey:** Fulfil & dispatch
- **Actor:** seller
- **Absorbs:** T-064 (done), T-123 (done)
- **Backend scope:** Fulfilment: the ship step, delivery signals and deadlines. Already built (T-064).
- **Frontend scope:** Seller trade handling: Seller tabs (Seller-2, Seller-3), mandatory proof and counter-proposal (W1–W3, BR1), dispatch guard (SD1), Park waybill and handover OTP (X1, X2), Active Orders (AC8), seller pick (MI3). _11 v2 screens._
- **Status:** Done
- **Depends on:** F-017, F-062 _(MVP since 2026-11-19; turns on its Park path)_, F-066 _(MVP since 2026-11-19; turns on ship-to-company)_
- **MVP:** yes
- **Note:** Its dependencies on logistics packages (F-066) and Park (F-062) are dropped for MVP: the seller marks shipped and supplies their own tracking.

### Journey: Deliver & inspect

#### F-027 — Confirm delivery, inspect, complete and release

- **Journey:** Deliver & inspect
- **Actor:** buyer
- **Absorbs:** T-065 (done), T-074 (done), T-118 (done)
- **Backend scope:** Inspection and completion, and release and settlement. Both already built (T-065, T-074).
- **Frontend scope:** Delivery and inspection: confirm delivery (Z4, Z5), live logistics and buyer handover PIN (AB1, AB2), delivery extension (DE1–DE4), inspection checklist (BEI1, BEI2), buyer tab (Customer-4), seller pick (MI4). _12 v2 screens._
- **Status:** Done
- **Depends on:** F-022, F-062 _(MVP since 2026-11-19; turns on the AB1/AB2 pickup PIN)_
- **MVP:** yes
- **Note:** Its dependency on Park integration (F-062) is dropped for MVP — self-arranged delivery only, no hub custody and no pickup PIN.

#### F-028 — Delivery and evidence in the workspace

- **Journey:** Deliver & inspect
- **Actor:** buyer, seller
- **Absorbs:** T-195 (done)
- **Backend scope:** Served by F-026 and F-027.
- **Frontend scope:** Trade Workspace supporting sheets for delivery and evidence, CWT-S08–CWT-S13. _6 v2 screens._
- **Status:** Done
- **Depends on:** F-022
- **MVP:** yes
- **Note:** Closed 2026-11-17. Five screens merged 2026-11-13; CWT-S13 was held as a seam because no party-facing call attached a file to a trade or case. The owner answered on 2026-11-17: upload through the files endpoint, then attach the file to the evidence. `POST /trades/:id/evidence` and `GET /trades/:id/evidence` now do that, over the new append-only `trade_evidence_media` table (migration 0051), with the counterparty grant inside the attach transaction. Video is refused because `ALLOWED_CONTENT_TYPES` has no video type; the screen offers photos and PDFs. Dispatch is seller-only and inspection buyer-only, which deviates from the reference's "Both" label. Staff removal of evidence is `docs/runbooks/trade-evidence-removal.md`. **The status line carried explanatory prose until 2026-11-15**, which is not one of the three legal values and so broke `scripts/test/progress-tickets.test.ts`; the detail belongs here.

#### F-029 — Capture and compare proof media

- **Journey:** Deliver & inspect
- **Actor:** buyer, seller
- **Absorbs:** T-197 (todo)
- **Backend scope:** Served by F-008 (evidence storage) and F-027.
- **Frontend scope:** Trade execution · Proof media, PM-1–PM-8: mandatory seller proof capture, quality checks and the buyer's side-by-side comparison. _8 v2 screens._
- **Status:** Done
- **Depends on:** F-022
- **MVP:** yes
- **Note:** docs/MVP.md calls this 'the heart of inspection'. Split from F-027 because it is a self-contained capture-and-compare component used by fulfilment, inspection and disputes alike.

### Journey: Issues & resolution

#### F-030 — Cancel a trade and get a refund

- **Journey:** Issues & resolution
- **Actor:** buyer, seller
- **Absorbs:** T-066 (done), T-075 (done), T-119 (done)
- **Backend scope:** Post-funding cancellation and can't-fulfil refunds; refunds against the ledger with the Q4 fee rule (T-066, T-075).
- **Frontend scope:** Cancel a Trade (CT1, CT2, AR1) and Cancel After Funding (CR1–CR3, SC1, SC2). _8 v2 screens._
- **Status:** Done
- **Note (2026-11-12):** backend layer (T-066, T-075, migration 0049) merged; next: the T-119 UI layer (CT1, CT2, AR1, CR1–CR3, SC1, SC2).
- **Depends on:** none
- **MVP:** yes

#### F-031 — Lifecycle exceptions: expiry, withdrawal and inspection updates

- **Journey:** Issues & resolution
- **Actor:** buyer, seller
- **Absorbs:** T-198 (todo)
- **Backend scope:** Served by F-017, F-027 and F-030.
- **Frontend scope:** Lifecycle exceptions (WD-01 withdrawal, IE-03 inspection extension) and trade extras SP-M20–SP-M22, SP-M24. _6 v2 screens._
- **Status:** Not started
- **Depends on:** F-022, F-030
- **MVP:** yes

#### F-032 — Report an issue and open a dispute

- **Journey:** Issues & resolution
- **Actor:** buyer, seller
- **Absorbs:** T-080 (todo), T-081 (todo), T-120 (todo), T-196 (todo)
- **Backend scope:** Disputes core — opening, evidence windows, outcomes — and evidence comparison read models (T-080, T-081).
- **Frontend scope:** Buyer and seller dispute screens (Customer-7, Customer-8, Seller-7, Seller-8, H1, H2, AC6), evidence comparison (Y1), plus the workspace resolution and issue-reporting sheets (DI-01, CWT-S14–CWT-S18, SP-M23). _15 v2 screens._
- **Status:** Not started
- **Progress note (2026-11-19):** Merged to `staging`, both layers in one cycle. Backend complete (migrations `0054`/`0055`, `migration:safety` clean; three invariants enforced in Postgres — one active case per trade, one open mediation offer per party, and a trigger refusing decisions that do not sum to escrow) and 12 of 15 screens. **Not Done:** no visual check, and CWT-S16/S17/S18 ship as honest placeholders because they are per-item views of a one-item trade and the orders module does not exist. The commission question is **answered** — commission comes from the seller — so F-033 and F-034 are unblocked.
- **Correction (2026-11-19, after the merge).** The note above first read as though the feature worked end to end. It did not. Running the real app found that **all five dispute routes crashed**: each page is a server component that passed a `render` function into the `'use client'` `WithDispute`, so `issue`, `dispute/status`, `dispute/evidence`, `dispute/withdraw` and `appeal` threw "Functions cannot be passed directly to Client Components" before drawing anything. 22 component tests, an axe pass and a green CI all missed it, because jsdom has no server/client boundary. Fixed the same day with a serialisable `screen` discriminant, and verified in a browser. The 19 integration tests also ran for the first time on CI: 18 pass, and one is **skipped against a real product gap** — withdrawing a dispute closes the case but strands the trade in `DISPUTED`, which has no exit but `RESOLVE_DISPUTE`, so the money stays held for ever. That needs the owner; see `docs/manager/RUN_LOG.md`.
- **Progress note (2026-11-20):** The visual check has now run on all 12 built screens (5.8–15.1%, most of it the 28px app-shell header offset; records in `docs/ui-review/T-120/` and `T-196/`). It found Seller-8 unreachable, now routed at `/trade/[id]/dispute/respond`. The replacement option is hidden on Seller-8 and Y1: it sent `RELEASE_SELLER_FULL` on a promise nothing enforces, and replacement belongs to F-034. **Owner decisions:** F-032 is Done without the evidence uploader on Customer-7, Seller-8 and AC6 (a follow-up). Withdrawing a dispute **resumes inspection with the time it had left**, and a dispute opened before inspection (from `SHIPPED` or `UNCONFIRMED_DELIVERY`) returns the trade to that status. **Not Done until the withdrawal fix lands**: it needs a migration (the `trade_action` enum and `trade.is_valid_transition`), so it follows F-065's `0057`.
- **Depends on:** F-022, F-030
- **MVP:** yes
- **Note:** Largest issues feature at 15 screens; roughly two cycles. Resolution _execution_ is split out into F-033/F-034 because it is a different flow with its own tracks.

#### F-033 — Resolution execution: the return track

- **Journey:** Issues & resolution
- **Actor:** buyer, seller
- **Absorbs:** T-199 (todo)
- **Backend scope:** Served by F-030 (refund rails) and F-032.
- **Frontend scope:** Resolution Execution — Mobile Web, Track A return (RX-01–RX-09) and the shared return-custody entry points RX-18, RX-19. _11 v2 screens._
- **Status:** Not started
- **Depends on:** F-030, F-032
- **MVP:** yes

#### F-034 — Resolution execution: replacement and mutual settlement

- **Journey:** Issues & resolution
- **Actor:** buyer, seller
- **Absorbs:** T-200 (todo)
- **Backend scope:** Served by F-030 and F-032.
- **Frontend scope:** Track B — Replacement (RX-10, RX-11) and Track C — Mutual settlement (RX-12–RX-15). _6 v2 screens._
- **Status:** Not started
- **Depends on:** F-030, F-032, F-033
- **MVP:** yes

#### F-035 — Decide a dispute in TrustOps

- **Journey:** Issues & resolution
- **Actor:** staff/TrustOps
- **Absorbs:** T-143 (todo)
- **Backend scope:** Served by F-032 and the universal case of F-050.
- **Frontend scope:** TrustOps · 07 · Disputes & appeals, OP-20–OP-22, on `DecisionPanel`. _3 v2 screens._
- **Status:** Not started
- **Depends on:** F-032
- **MVP:** yes
- **Note:** Kept in the Issues journey, not the console journey: a dispute is one journey with two ends, and shipping the buyer's side without the staff decision screen would repeat exactly the mistake this re-plan corrects.

#### F-036 — Return custody at a Park hub

- **Journey:** Issues & resolution
- **Actor:** buyer, Park agent
- **Absorbs:** T-201 (todo)
- **Backend scope:** Park custody applied to returns, via F-061 and F-062 (no new backend of its own).
- **Frontend scope:** Track D — Return custody, RX-16, RX-17 (consumer) and RX-20, RX-21 (Park agent). _4 v2 screens._
- **Status:** Not started
- **Depends on:** F-033, F-061, F-062
- **MVP:** yes
- **Note:** **Brought into the MVP 2026-11-19 by the owner**, with Park, logistics and the core TrustOps console.

### Journey: Complete & grow

#### F-037 — Get paid out

- **Journey:** Complete & grow
- **Actor:** seller
- **Absorbs:** T-073 (done), T-124 (done)
- **Backend scope:** Payout accounts, preferences and payouts against the ledger (T-073).
- **Frontend scope:** Seller Payouts (AB5, AB6, WF1, PR1) and the seller money tab (Seller-6). _5 v2 screens._
- **Status:** Done
- **Depends on:** none
- **MVP:** yes
- **Progress note (2026-11-11):** T-073 (backend) merged; next: T-124 Seller Payouts UI (AB5, AB6, WF1, PR1, Seller-6) over the merged `/me/payout-accounts` and `/me/payouts` routes.
- **Progress note (2026-11-11, later):** T-124 UI merged to `main`. Both layers are built, but the feature stays `Backend done, UI outstanding` because no user can reach the screens yet: the Account Payouts row needs `viewer.hasSold`, and `resolveViewer` still returns the anonymous viewer. Next: fill the viewer seam (owner answered yes on 2026-11-12: `resolveViewer` returns the signed-in viewer with `hasSold`), then mark Done. Resume as in-flight work.
- **Progress note (2026-11-13):** Viewer seam filled and merged: `resolveViewer` reads `hasSold` and `certifiedMerchant` from the sealed session hint (backend `GET /me/viewer`), so a signed-in seller reaches `/account/payouts` from Account. `parkAgent` stays `'none'` until T-091. Feature Done.

#### F-038 — Leave a review

- **Journey:** Complete & grow
- **Actor:** buyer, seller
- **Absorbs:** T-127 (todo)
- **Backend scope:** Served by F-016.
- **Frontend scope:** Leave a Review (AC5, SR1, SR2). _3 v2 screens._
- **Status:** Not started
- **Depends on:** F-016
- **MVP:** no
- **Note:** Deferred.

#### F-039 — Seller insights, reporting and referrals

- **Journey:** Complete & grow
- **Actor:** seller
- **Absorbs:** T-105 (todo), T-125 (todo), T-106 (todo)
- **Backend scope:** Reporting, analytics and seller insights (M16) and referral and growth (M18) (T-105, T-106).
- **Frontend scope:** Seller Insights & Analytics (AN1) and its desktop frame (DX-33). _2 v2 screens._
- **Status:** Not started
- **Depends on:** F-016, F-052
- **MVP:** no
- **Note:** Deferred. T-106 referral has no screen anywhere in v2 — see Gaps found.

### Journey: Sell on Komtru

#### F-040 — Apply for merchant certification and have it reviewed

- **Journey:** Sell on Komtru
- **Actor:** merchant, staff/TrustOps
- **Absorbs:** T-055 (todo), T-051 (done), T-121 (todo), T-154 (done)
- **Backend scope:** Merchant applications and certification; business verification with bank name-match, address and social proof. Business verification already built (T-051); certification outstanding (T-055).
- **Frontend scope:** Merchant verification (SO1–SO5), business verification result (BVR1), the account's merchant verification tab (M2), and the TrustOps review screen OP-61. _8 v2 screens._
- **Status:** Backend done, UI outstanding
- **Progress note (2026-11-19):** Merged to `staging`. T-055 and T-154 landed earlier; **T-121 is now built and merged** — all 7 screens, reframed as merchant verification per the owner (see T-121). The no-entry-point blocker is closed: Account › Verification reaches the flow in every state. **Not Done:** `pnpm visual-check` has never passed on these screens, so the epic 13 bar is unmet. Still open: the T-055 bank name-match criterion (unsigned off since 2026-11-15, SO4 shows the reference banner while enforcing nothing), no read-only view of an application in review, and the per-trade cap the copy alludes to is answered but unbuilt. See `docs/manager/RUN_LOG.md`.
- **Depends on:** F-037
- **MVP:** yes
- **Note:** Applicant and reviewer in one feature on purpose: a certification no one can approve is not a feature.

#### F-041 — List items and manage stock

- **Journey:** Sell on Komtru
- **Actor:** merchant
- **Absorbs:** T-056 (todo), T-122 (todo)
- **Backend scope:** Listings lifecycle, images and stock (T-056).
- **Frontend scope:** Shop and listings (Seller-1, Seller-4, Seller-5) and Edit Listing & Manage Stock (EL1, EL2). _5 v2 screens._
- **Status:** Withdrawn
- **Depends on:** F-040
- **MVP:** no
- **Note:** **Deferred 2026-11-15 by the owner.** Listings and stock are out of the MVP: a trade is
  proposed party to party and never needs a catalogue. F-017 already proved this when multi-item
  ordering was split out of it on 2026-11-09. **Withdrawn 2026-11-20 by the owner:** there is no
  storefront. Merchant status lifts the selling limit (F-082); it does not open a shop.

#### F-042 — Shop settings and catalogue import

- **Journey:** Sell on Komtru
- **Actor:** merchant
- **Absorbs:** T-202 (todo)
- **Backend scope:** Served by F-040 and F-041.
- **Frontend scope:** Supporting · Shop settings (SP-M25–SP-M29) and Catalogue import (SP-M34–SP-M36). _8 v2 screens._
- **Status:** Withdrawn
- **Depends on:** F-041
- **MVP:** no
- **Note:** **Deferred 2026-11-15 by the owner**, with F-041. Catalogue import is bulk listing
  creation, and a shop with no listings is the seller profile F-016 already draws. **Withdrawn
  2026-11-20 by the owner**, with F-041.

#### F-043 — Customers, tax documents and badges

- **Journey:** Sell on Komtru
- **Actor:** merchant
- **Absorbs:** T-203 (todo)
- **Backend scope:** Served by F-016, F-039 and F-041.
- **Frontend scope:** Supporting · Customers (SP-M37, SP-M38) and Tax & badges (SP-M39–SP-M42). _6 v2 screens._
- **Status:** Not started
- **Depends on:** F-016, F-039, F-041
- **MVP:** no
- **Note:** Deferred: storefront polish after the first merchants are live. **2026-11-20:** the
  storefront is withdrawn (F-041). What survives is tax documents and the merchant badge; Customers
  goes with the shop. Re-scope before it is picked up.

### Journey: Account, trust & support

#### F-044 — Account basics, addresses, documents and system states

- **Journey:** Account, trust & support
- **Actor:** buyer, seller
- **Absorbs:** T-042 (done), T-046 (done), T-204 (done)
- **Backend scope:** Saved delivery addresses and the location catalog of states, cities and city requests. Already built (T-042, T-046).
- **Frontend scope:** Supporting · Account & settings address screens (SP-M01, SP-M02, SP-M33), Money & documents (SP-M11–SP-M13) and System states (SP-M14–SP-M19). _12 v2 screens._
- **Status:** Done
- **Depends on:** F-030, F-046
- **MVP:** yes
- **Note:** Closed 2026-11-17, built ahead of its F-030 and F-046 parents on the owner's call, extending the account shell from F-037 and F-045 rather than waiting. **SP-M15 (Update required) is wired but NOT LIVE** — it fires only on a 426 carrying problem code `UPGRADE_REQUIRED`, and the backend has no minimum-version concept, so nothing emits it; see `docs/ui-review/T-204/SP-M15.md`. Money and documents are bounded by what the ledger records: SP-M11 prints from the browser (no PDF service, no stated retention), SP-M13 is CSV over payouts and refunds only (no route lists a buyer's payments), and SP-M12 drops the reference's delivery promises. Display preferences (SP-M33) are device-only, in localStorage, applied before first paint by an inline script so accessibility settings do not flash their defaults. Three "ui-kit only" deviations are recorded in `docs/ui-review/T-204/README.md`. Tracked follow-ups: the 503 strip flaps when unrelated queries succeed, SP-M16 does not cover a cold return with a lapsed cookie, an inactive saved city blocks unrelated edits, `/status` has an offline-after-load gap, and the trade action screens keep their own 404 panel instead of SP-M19.

#### F-045 — Verify yourself, and close or recover an account

- **Journey:** Account, trust & support
- **Actor:** buyer, seller
- **Absorbs:** T-039 (done), T-050 (done), T-205 (done)
- **Backend scope:** Verification core (NIN/BVN, liveness, levels) and account lifecycle, recovery and NDPA hooks. Already built (T-050, T-039). A phone-number change flow was added on 2026-11-17 (see the note).
- **Frontend scope:** Account security and lifecycle: MFA setup (AS1, AS2, TF1, TF2), verification (VF1), close account (CA1, CA2) and Supporting · Account & settings SP-M03–SP-M05. _10 v2 screens._
- **Status:** Done
- **Depends on:** F-046
- **MVP:** yes
- **Note:** Closed 2026-11-17, built ahead of its F-046 parent on the owner's call: the account shell from F-037's payouts UI was extended rather than waiting for trust history. SP-M05 needed a backend that did not exist, so the owner asked for it and the feature grew a three-step change-number flow (`POST /me/phone/change`, `/confirm-current`, `/confirm-new`) with migration 0052 (`user_phones.change_state`, two partial unique indexes, two checks). That new code was reviewed twice on opus, which reproduced two working exploits against a live database — a concurrent-start race that bound a phone number the caller never proved, and an alarm redirect that sent the "your number was changed" SMS to the attacker. Both are closed and re-verified by probe: the invariant is now a database constraint, starting a change needs step-up (any factor, the owner's call), SMS factors are revoked rather than moved on a change, the OTP send budget is keyed per number so toll fraud is capped globally, and a 15-minute cooldown after a completed change stops the alarm being chained away. Declined by the owner: revoking other sessions on a change. Not done: no middleware redirects a suspended account to AS1/AS2, and there is no SMS second-method setup UI.
- **Progress note (2026-11-19):** Youverify wired as the first real KYC provider, on branch `f-045-youverify-kyc` (design: `docs/superpowers/specs/2026-11-19-youverify-kyc-design.md`). **The feature's name was overstated until now:** both backend tickets were Done, yet no user could start an identity check — VF1's submission forms render only inside a rejection branch, so a first-time user saw "Nothing to fix" and no control. That entry point now exists. **Live:** NIN and BVN against `api.sandbox.youverify.co`, verified against the real sandbox. **Built but unproven:** liveness through Youverify's browser SDK, resolved by a signed webhook at `POST /v1/webhooks/youverify` with a full delivery lifecycle (migration 0056) — no real delivery has ever been received, so the payload shape in `resolve-liveness.job.ts` is a guess that fails closed. **Blocked on account entitlements:** CAC answers 403 on both company endpoints and the bank name-match path is unknown (four candidates 404), so those two adapter methods refuse by name; liveness entitlement is unconfirmed. **Not deployed:** `TRUST_KYC_PROVIDER` stays `FAKE` everywhere, because flipping it would hard-fail the live `/verification/bank-account` route. Also fixed in passing: `normaliseRcNumber` stripped the CAC entity prefix, collapsing `RC1487322`, `BN1487322` and `LLP1487322` onto one §7 duplicate key — and Youverify rejects the stripped form outright. Status stays **Done** on the strength of the 2026-11-17 scope; the identity half is not yet real in any deployed environment.
- **Progress note (2026-11-19, later):** Youverify is now **live on staging** — `TRUST_KYC_PROVIDER=YOUVERIFY` against `api.sandbox.youverify.co`, with the webhook answering 200 at `https://staging-api.komtru.com/v1/webhooks/youverify`. Getting there exposed that the staging host had been deploying `main`, not `staging` (`REPO_REF` pinned in `/srv/komtru/deploy.conf`); corrected, so the box now runs `staging`. Two defects found by using it, both fixed on `f-045-liveness-abandon-and-vf1-wide`: closing the SDK without finishing left the request at `PROVIDER_PENDING` for the full 24h TTL, with VF1 stuck on "We're checking" and no control to press — there is now `POST /verification/liveness/session/:requestId/abandon`, landing in `EXPIRED` with a new `ABANDONED` reason that the status endpoint keeps out of `rejections` so the start control returns at once; and the failed-liveness retry offered the old photo-upload form, which could never produce the signed webhook a verdict arrives on, so it now reopens the SDK. The upload path (`ResubmitSelfie`) is gone from VF1; the `/verification/liveness` route itself is untouched. VF1 also gained the house wide-screen treatment (`md:760`, two columns at `lg`) — a recorded deviation, since `SCREEN_INDEX.md` draws it mobile-only. **Still unproven:** no real liveness webhook has been received, so `resolve-liveness.job.ts`'s payload shape remains a guess, and liveness entitlement on the Youverify account is still unconfirmed.

#### F-046 — Trust history, account and notification settings

- **Journey:** Account, trust & support
- **Actor:** buyer, seller
- **Absorbs:** T-126 (todo)
- **Backend scope:** Served by F-007, F-016 and F-045.
- **Frontend scope:** Trust History · Account · Notifications (M1, M3, J1–J4, LS1), notification preferences (NP1) and the account tabs (Customer-10, Seller-10). _10 v2 screens._
- **Status:** Not started
- **Depends on:** F-016
- **MVP:** yes

#### F-047 — Message the other party

- **Journey:** Account, trust & support
- **Actor:** buyer, seller
- **Absorbs:** T-108 (todo), T-128 (todo)
- **Backend scope:** Trade messaging over the F-007 socket gateway (T-108).
- **Frontend scope:** Messaging Inbox (AC7, MC1) and the message tabs (Customer-9, Seller-9). _4 v2 screens._
- **Status:** Not started
- **Depends on:** none
- **MVP:** no
- **Note:** Deferred.

#### F-048 — Raise and resolve a support ticket

- **Journey:** Account, trust & support
- **Actor:** buyer, seller, staff/TrustOps
- **Absorbs:** T-100 (todo), T-129 (todo), T-151 (todo)
- **Backend scope:** Support tickets (M10) (T-100).
- **Frontend scope:** Help & Support (L1), Supporting · Help & contact (SP-M06–SP-M09) and the TrustOps customer-success queue (OP-41–OP-43). _8 v2 screens._
- **Status:** Not started
- **Depends on:** none
- **MVP:** no
- **Note:** Deferred. Grouped end to end so the console side never ships ahead of the customer side again.

### Journey: TrustOps console

#### F-049 — Staff sign-in, console shell and roles

- **Journey:** TrustOps console
- **Actor:** staff/TrustOps
- **Absorbs:** T-037 (done), T-038 (done), T-140 (done)
- **Backend scope:** RBAC catalog, staff login, admin endpoints and staff invitations. Already built (T-037, T-038).
- **Frontend scope:** Console scaffold, permission-filtered sidebar and staff auth; TrustOps · 09 team screens OP-28 and OP-33. Built (T-140). _2 v2 screens._
- **Status:** Done
- **Depends on:** none
- **MVP:** yes
- **Note:** Genuinely Done. Note T-140's recorded follow-ups: `GET /admin/me` and staff-scoped MFA routes.

#### F-050 — Work queue and the universal case

- **Journey:** TrustOps console
- **Actor:** staff/TrustOps
- **Absorbs:** T-107 (done), T-141 (done)
- **Backend scope:** Universal case model, work queue and rule-based advisory. Already built (T-107).
- **Frontend scope:** Work queue and universal case: TrustOps · 01 Orient (OP-01–OP-04), the case views OP-12 and OP-19, and the mobile check-in P1. Built (T-141). _7 v2 screens._
- **Status:** Done
- **Depends on:** none
- **MVP:** yes

#### F-051 — Review identity and KYC

- **Journey:** TrustOps console
- **Actor:** staff/TrustOps
- **Absorbs:** T-052 (done), T-144 (done)
- **Backend scope:** Duplicate identity detection and the KYC review queue. Already built (T-052).
- **Frontend scope:** TrustOps · 02 · People & network identity review, OP-05 and OP-06. _2 v2 screens._
- **Status:** Done
- **Depends on:** none
- **MVP:** yes

#### F-052 — Fraud signals and restrictions

- **Journey:** TrustOps console
- **Actor:** staff/TrustOps
- **Absorbs:** T-101 (todo), T-145 (todo)
- **Backend scope:** Risk and fraud (M13): signals, scores and restrictions (T-101).
- **Frontend scope:** TrustOps · 06 · Risk (OP-17, OP-18) and · 14 · Risk & compliance (OP-44, OP-45). _4 v2 screens._
- **Status:** Not started
- **Depends on:** none
- **MVP:** yes
- **Note:** **Brought into the MVP 2026-11-19 by the owner**, with Park, logistics and the core TrustOps console.

#### F-053 — Settlement operations, chargebacks and reconciliation

- **Journey:** TrustOps console
- **Actor:** staff/TrustOps
- **Absorbs:** T-076 (todo), T-146 (todo)
- **Backend scope:** Chargebacks, reconciliation and settlement operations (T-076).
- **Frontend scope:** TrustOps · 04 and · 10 money operations (OP-13, OP-14, OP-34, OP-35) and the fulfilment exception OP-50. _5 v2 screens._
- **Status:** Not started
- **Depends on:** F-030
- **MVP:** yes
- **Note:** **Brought into the MVP 2026-11-19 by the owner**, with Park, logistics and the core TrustOps console. Reconciliation is infrastructure with a console surface; it is in the console journey rather than a money journey because no buyer or seller ever sees it.

#### F-054 — Directory, roles, approvals and impersonation

- **Journey:** TrustOps console
- **Actor:** staff/TrustOps
- **Absorbs:** T-103 (todo), T-150 (todo)
- **Backend scope:** Administration: impersonation and the admin action log (M14) (T-103).
- **Frontend scope:** TrustOps · 09 · Team & access (OP-26, OP-27, OP-29–OP-32) and the directory search OP-25. _7 v2 screens._
- **Status:** Not started
- **Depends on:** none
- **MVP:** yes
- **Note:** **Brought into the MVP 2026-11-19 by the owner**, with Park, logistics and the core TrustOps console.

#### F-055 — Audit, compliance and the trust trail

- **Journey:** TrustOps console
- **Actor:** staff/TrustOps
- **Absorbs:** T-104 (todo), T-152 (todo)
- **Backend scope:** Audit and compliance (M15): the trust trail and retention (T-104).
- **Frontend scope:** TrustOps · 08 search & audit (OP-23, OP-24), · 11 audit & assurance (OP-36, OP-37), · 12 OP-40 and · 15 OP-52. _6 v2 screens._
- **Status:** Not started
- **Depends on:** F-054
- **MVP:** yes
- **Note:** **Brought into the MVP 2026-11-19 by the owner**, with Park, logistics and the core TrustOps console.

#### F-056 — Console overview, configuration, reporting and the location catalog

- **Journey:** TrustOps console
- **Actor:** staff/TrustOps
- **Absorbs:** T-153 (todo), T-155 (todo)
- **Backend scope:** Served by F-006 (configuration) and F-039 (analytics); location catalog management endpoints already exist in F-044.
- **Frontend scope:** TrustOps · 12 rules (OP-38, OP-39), · 15 OP-49, · 21 insight & reporting (OP-65, OP-66), · 22 partners & configuration (OP-70, OP-71), plus location catalog management — which has no v2 screen (see Gaps found). _7 v2 screens._
- **Status:** Not started
- **Depends on:** F-039
- **MVP:** no
- **Note:** Deferred.

#### F-057 — TrustOps: operations control, knowledge, quality and governance

- **Journey:** TrustOps console
- **Actor:** staff/TrustOps
- **Absorbs:** T-215 (todo), T-216 (todo)
- **Backend scope:** Served by F-052 and F-055.
- **Frontend scope:** TrustOps · 15 · Operations control (OP-46–OP-48), · 17 · Knowledge & quality (OP-53, OP-54) and · 18 · Governance (OP-55–OP-58). _9 v2 screens._
- **Status:** Not started
- **Depends on:** F-052, F-055
- **MVP:** no
- **Note:** Deferred. Two v2 tickets merged: nine screens is one cycle.

#### F-058 — TrustOps: treasury, communications and field audits

- **Journey:** TrustOps console
- **Actor:** staff/TrustOps
- **Absorbs:** T-217 (todo), T-218 (todo)
- **Backend scope:** Served by F-053 and F-055.
- **Frontend scope:** TrustOps · 20 · Communications & treasury (OP-62–OP-64) and · 23 · Field audits (AU-1–AU-4, OP-72). _8 v2 screens._
- **Status:** Not started
- **Depends on:** F-053, F-055, F-064
- **MVP:** no
- **Note:** Deferred.

#### F-059 — TrustOps: people development and the TrustOps tablet

- **Journey:** TrustOps console
- **Actor:** staff/TrustOps
- **Absorbs:** T-219 (todo), T-220 (todo)
- **Backend scope:** Served by F-049.
- **Frontend scope:** TrustOps · 24 · People development (OP-73–OP-75) and · 25 · Tablet (OP-T1–OP-T6). _9 v2 screens._
- **Status:** Not started
- **Depends on:** F-021, F-035, F-054, F-060
- **MVP:** no
- **Note:** Deferred.

### Journey: Park network

#### F-060 — Apply to run a Park hub and have it approved

- **Journey:** Park network
- **Actor:** Park agent, staff/TrustOps
- **Absorbs:** T-090 (todo), T-091 (todo), T-130 (todo), T-147 (todo)
- **Backend scope:** Park schema, and hub onboarding, activation and lifecycle (T-090, T-091).
- **Frontend scope:** Park Hub Registration & Onboarding (PH1–PH6), the TrustOps-owned lifecycle screens PA7, PA8, and the TrustOps Park applications queue (OP-07–OP-09). _11 v2 screens._
- **Status:** Not started
- **Depends on:** F-065
- **MVP:** yes
- **Note:** **Brought into the MVP 2026-11-19 by the owner**, with Park, logistics and the core TrustOps console. It is the first Park agent app feature, so it also brings up `park-agent-app`'s host (a Vercel project and its DNS record), which F-075 left for this wave.

#### F-061 — Log an arrival, inspect and hold an item in custody

- **Journey:** Park network
- **Actor:** Park agent
- **Absorbs:** T-092 (todo), T-170 (todo), T-171 (todo), T-172 (todo)
- **Backend scope:** Custody operations API (T-092).
- **Frontend scope:** Park agent app scaffold, login and hub context (no v2 screen — see Gaps found), hub dashboard and log arrival (U1, U2), and inspection, damage and incidents (U3, U6, PA10). _5 v2 screens._
- **Status:** Not started
- **Depends on:** F-060
- **MVP:** yes
- **Note:** **Brought into the MVP 2026-11-19 by the owner**, with Park, logistics and the core TrustOps console.

#### F-062 — Safe handover at the hub

- **Journey:** Park network
- **Actor:** Park agent, buyer
- **Absorbs:** T-093 (todo), T-173 (todo)
- **Backend scope:** Park and trade integration — custody events wired into the trade state machine (T-093).
- **Frontend scope:** Safe handover (U4, U5), which turns on the AB1/AB2 pickup PIN screens F-027 already draws. _2 v2 screens._
- **Status:** Not started
- **Depends on:** F-061
- **MVP:** yes
- **Note:** **Brought into the MVP 2026-11-19 by the owner**, with Park, logistics and the core TrustOps console.

#### F-063 — Park fees, handover log, hub tools and stock count

- **Journey:** Park network
- **Actor:** Park agent
- **Absorbs:** T-094 (todo), T-174 (todo), T-206 (todo)
- **Backend scope:** Park cash-fee notices and the handover log (T-094).
- **Frontend scope:** Handover log, hub profile and staff (PE1, PA9) and Supporting · Hub tools and Hub count (SP-M30–SP-M32, SP-M43–SP-M45). _8 v2 screens._
- **Status:** Not started
- **Depends on:** F-060, F-061, F-062
- **MVP:** yes
- **Note:** **Brought into the MVP 2026-11-19 by the owner**, with Park, logistics and the core TrustOps console.

#### F-064 — Park network oversight in TrustOps

- **Journey:** Park network
- **Actor:** staff/TrustOps
- **Absorbs:** T-095 (todo), T-148 (todo)
- **Backend scope:** Park TrustOps read models (T-095).
- **Frontend scope:** TrustOps · 05 · Custody (OP-15, OP-16) and · 19 · Network & merchants Park views (OP-59, OP-60). _4 v2 screens._
- **Status:** Not started
- **Depends on:** F-060, F-062
- **MVP:** yes
- **Note:** **Brought into the MVP 2026-11-19 by the owner**, with Park, logistics and the core TrustOps console.

### Journey: Logistics partner

#### F-065 — Logistics companies, teams and the partner portal

- **Journey:** Logistics partner
- **Actor:** logistics partner
- **Absorbs:** T-085 (todo), T-086 (todo), T-160 (todo), T-161 (todo)
- **Backend scope:** Logistics schema and Park seed; logistics auth, companies and members (T-085, T-086).
- **Frontend scope:** Logistics portal scaffold and login, and team management — neither has a v2 screen (see Gaps found).
- **Status:** Not started
- **Depends on:** none
- **MVP:** yes
- **Note:** **Brought into the MVP 2026-11-19 by the owner**, with Park, logistics and the core TrustOps console. It is the first partner portal feature, so it also brings up `logistics-ops`'s host (a Vercel project and its DNS record), which F-075 left for this wave.

#### F-066 — Ship through a logistics company

- **Journey:** Logistics partner
- **Actor:** seller, logistics partner
- **Absorbs:** T-087 (todo), T-162 (todo), T-149 (todo)
- **Backend scope:** Package pipeline and ship-to-company (T-087).
- **Frontend scope:** Partner portal packages (no v2 screen) and the TrustOps logistics screens OP-51, OP-67–OP-69. _4 v2 screens._
- **Status:** Not started
- **Depends on:** F-065
- **MVP:** yes
- **Note:** **Brought into the MVP 2026-11-19 by the owner**, with Park, logistics and the core TrustOps console. Turns on the ship-to-company path F-026 leaves out for MVP.

### Journey: Desktop & tablet journeys

#### F-067 — Desktop: arrive, home and discover

- **Journey:** Desktop & tablet journeys
- **Actor:** buyer, seller
- **Absorbs:** T-207 (todo)
- **Backend scope:** Served by F-011, F-015, F-016 and F-045.
- **Frontend scope:** Desktop · 01 · Arrive & verify (DX-01, DX-02), · 02 · Home (DX-03–DX-05) and · 03 · Discover (DX-06–DX-09). _9 v2 screens._
- **Status:** Not started
- **Depends on:** F-015, F-016
- **MVP:** yes
- **Progress note (2026-11-19), entry screens:** DX-01 Welcome — Log in is built and merged to `staging` (6.2% of pixels differ through the stand-in). By the owner's direction, every other entry screen (welcome, sign up, verify, terms, terms updated, reset and set password, session expired, service notice, update required, too many attempts) uses DX-01's two-column frame on desktop, and the onboarding walkthrough OB1–OB5 a centred card; none of those is drawn wide, so they are read by eye (`docs/ui-review/entry-wide.md`, `docs/ui-review/onboarding-wide.md`). Phone is pixel-identical to staging on all 24 captures. The Trade Code box needs a session (`/find` and `GET /trades/by-code` are authenticated), so a logged-out visitor goes through log in, or sign up, and lands on the trade. "Keep me signed in" is not built: the platform has no session-length option. **Not started:** DX-02 (identity verification, being rebuilt in the F-045 YouVerify work), DX-03–DX-09.

#### F-068 — Desktop: propose, agree and fund

- **Journey:** Desktop & tablet journeys
- **Actor:** buyer, seller
- **Absorbs:** T-208 (todo)
- **Backend scope:** Served by F-017, F-023 and F-024.
- **Frontend scope:** Desktop · 04 · Propose & agree (DX-10, DX-10B, DX-11–DX-14) and · 05 · Fund & protect (DX-15–DX-17). _9 v2 screens._
- **Status:** Not started
- **Progress note (2026-11-19):** Merged to `staging`. Built together with F-072 as one responsive pass, because `SCREEN_INDEX.md` pairs DX-10/TX-07, DX-10B/TX-07B and DX-15/TX-10 as the same screen at two widths. 8 of the pair's 20 screens built. **Not Done:** no visual check; DX-13 is blocked on the missing superseded-terms-versions route (logged as O2, now hit by two features); DX-14/TX-09 was left to F-032, which owned the workspace.
- **Depends on:** F-018, F-019, F-023, F-024
- **MVP:** yes

#### F-069 — Desktop: fulfil, deliver, inspect and complete

- **Journey:** Desktop & tablet journeys
- **Actor:** buyer, seller
- **Absorbs:** T-209 (todo)
- **Backend scope:** Served by F-026, F-027 and F-037. The F-041 dependency went with the 2026-11-15 catalogue cut; DX-31 and DX-32 lose their shop panel.
- **Frontend scope:** Desktop · 06 · Fulfil & dispatch (DX-18–DX-20), · 07 · Deliver & inspect (DX-21–DX-23, DX-38) and · 09 · Complete & grow (DX-31, DX-32). _9 v2 screens._
- **Status:** Not started
- **Depends on:** F-022, F-026, F-027, F-028, F-037
- **MVP:** yes
- **Progress note (2026-11-19):** Merged to `staging` with F-073 as one responsive pass, built by two agents split by journey (fulfil and payouts; deliver and inspect), each reviewed and fixed. **7 of 9 screens built:** DX-18 orders (no bulk bar: no endpoint, couriers out of MVP, messaging deferred), DX-19 dispatch workspace, DX-21 trades workspace, DX-23 inspect and compare, DX-38 evidence, DX-31 trade completed (at `/trade/[id]/completed`, because `/complete` is F-018's; drawn only from recorded activity, no review form while F-038 is deferred) and DX-32 payouts and performance (no fulfilment-rate, dispatch-time or returns KPIs: no data). **Not built:** DX-20 create listing (F-041, deferred) and DX-22 Park pickup (needs F-062). **Not Done:** those two screens, and the deviations listed in `docs/ui-review/T-209/` await the owner. Visual check ran through the stand-in for every built screen (3–8% of pixels differ).

#### F-070 — Desktop and tablet: issues and resolution

- **Journey:** Desktop & tablet journeys
- **Actor:** buyer, seller
- **Absorbs:** T-221 (todo)
- **Backend scope:** Served by F-032, F-033 and F-034.
- **Frontend scope:** Desktop · 08 · Issues & resolution (DX-24–DX-30) and Tablet · 08 · Issues & resolution (TX-15–TX-18). _11 v2 screens._
- **Status:** Not started
- **Depends on:** F-032, F-033, F-034
- **MVP:** yes
- **Note:** The one device feature that covers both desktop and tablet: T-190 split it out of T-210 and T-214 precisely because its journey is MVP while the rest of those tickets is not.

#### F-071 — Desktop: messages, trust, account, help and settings

- **Journey:** Desktop & tablet journeys
- **Actor:** buyer, seller
- **Absorbs:** T-210 (todo), T-211 (todo)
- **Backend scope:** Served by F-044, F-046, F-047 and F-048.
- **Frontend scope:** Desktop · 10 · Messages, trust & account (DX-34–DX-37) and · 11 · Help, documents & settings (SP-D01–SP-D06). _10 v2 screens._
- **Status:** Not started
- **Depends on:** F-016, F-044, F-046, F-047, F-048
- **MVP:** no
- **Note:** Deferred: messaging and help are deferred.

#### F-072 — Tablet: arrive, home, discover, propose and fund

- **Journey:** Desktop & tablet journeys
- **Actor:** buyer, seller
- **Absorbs:** T-212 (todo)
- **Backend scope:** Served by F-015, F-017, F-023 and F-024.
- **Frontend scope:** Tablet · 01 Arrive (TX-01), · 02 Home (TX-02–TX-04), · 03 Discover (TX-05, TX-06), · 04 Propose & agree (TX-07, TX-07B, TX-08, TX-09) and · 05 Fund & protect (TX-10). _11 v2 screens._
- **Status:** Not started
- **Progress note (2026-11-19):** Merged to `staging` as part of the F-068 responsive pass — see that feature's note. **Not Done.**
- **Progress note (2026-11-19), entry screens:** TX-01 Log in is built and merged to `staging` (3.4% of pixels differ at 820px; the harness's own 560px tablet frame measures the phone layout). Every other entry screen and the onboarding walkthrough use TX-01's centred card on tablet; see F-067's entry note. TX-02–TX-06 not started.
- **Depends on:** F-015, F-018, F-019, F-023, F-024
- **MVP:** yes

#### F-073 — Tablet: fulfil, deliver, inspect and payouts

- **Journey:** Desktop & tablet journeys
- **Actor:** buyer, seller
- **Absorbs:** T-213 (todo)
- **Backend scope:** Served by F-026, F-027 and F-037.
- **Frontend scope:** Tablet · 06 · Fulfil & dispatch (TX-11, TX-12), · 07 · Deliver & inspect (TX-13, TX-14, TX-22) and · 09 · Complete & grow (TX-19). _6 v2 screens._
- **Status:** Not started
- **Depends on:** F-026, F-027, F-028, F-037
- **MVP:** yes
- **Progress note (2026-11-19):** Merged to `staging` with F-069 (see that note). **All 6 screens built:** TX-11 orders (list with a detail pane), TX-12 dispatch, TX-13 trade workspace, TX-14 inspect and compare, TX-22 evidence, TX-19 payouts. **Not Done:** the harness compares tablet screens at the reference frame's 560px, below the app's 768px `md` breakpoint, so its tablet score measures the phone layout; the agents re-rendered the reference at 820px by hand (TX-13 3.9%, TX-14 10.0%, TX-22 7.4%; TX-11, TX-12 and TX-19 read by eye). The harness needs a tablet width before this can pass, and the deviations in `docs/ui-review/T-213/` await the owner.

#### F-074 — Tablet: messages, account and help

- **Journey:** Desktop & tablet journeys
- **Actor:** buyer, seller
- **Absorbs:** T-214 (todo)
- **Backend scope:** Served by F-046, F-047 and F-048.
- **Frontend scope:** Tablet · 10 · Messages & account (TX-20, TX-21) and · 11 · Help & settings (SP-T01–SP-T03). _5 v2 screens._
- **Status:** Not started
- **Depends on:** F-046, F-047, F-048
- **MVP:** no
- **Note:** Deferred.

### Journey: Launch & assurance (not a user journey)

#### F-075 — Hosting and real deploy jobs

- **Journey:** Launch & assurance (not a user journey)
- **Actor:** platform
- **Absorbs:** T-005 (done)
- **Backend scope:** Real deploy jobs per app, a Dockerfile per app and the GitHub remote (T-005).
- **Frontend scope:** None. Infrastructure.
- **Status:** Done
- **Depends on:** none
- **MVP:** yes
- **Note:** Done 2026-11-19, when the owner answered Q1 and shipped it. The backend deploys from CI to EC2 (production from `main`, staging from `staging`); the web apps deploy through Vercel's git integration, which replaced the per-app Dockerfiles in the original scope. logistics-ops and park-agent-app have no host until their post-MVP waves. Details on T-005.

#### F-076 — End-to-end critical paths

- **Journey:** Launch & assurance (not a user journey)
- **Actor:** platform
- **Absorbs:** T-180 (todo)
- **Backend scope:** Playwright critical paths against the real backend (T-180).
- **Frontend scope:** Exercises the shipped screens; adds none.
- **Status:** Not started
- **Depends on:** F-026, F-027, F-062, F-064, F-066
- **MVP:** yes
- **Note:** End to end is propose → fund → deliver → inspect → release, plus the dispute path, plus (since the owner brought them into the MVP on 2026-11-19) the Park handover, ship-to-company and Park network console paths through F-062, F-064 and F-066.

#### F-077 — Security review

- **Journey:** Launch & assurance (not a user journey)
- **Actor:** platform
- **Absorbs:** T-182 (todo)
- **Backend scope:** Security review of the whole surface (T-182).
- **Frontend scope:** None.
- **Status:** Not started
- **Depends on:** F-076
- **MVP:** yes

#### F-078 — Definition-of-done audit and first push

- **Journey:** Launch & assurance (not a user journey)
- **Actor:** platform
- **Absorbs:** T-183 (todo)
- **Backend scope:** Definition-of-done audit and the first push to the remote (T-183).
- **Frontend scope:** None.
- **Status:** Not started
- **Depends on:** none
- **MVP:** yes
- **Note:** Depends on every other feature; for the MVP cut, on every MVP feature. The "first push" half is overtaken: the owner pushed to `Komtru/komtru-web-mono-repo` and deployed from it on 2026-11-19 (F-075), so what is left is the definition-of-done audit.

#### F-079 — Load and resilience

- **Journey:** Launch & assurance (not a user journey)
- **Actor:** platform
- **Absorbs:** T-181 (todo)
- **Backend scope:** Load and resilience testing (T-181).
- **Frontend scope:** None.
- **Status:** Not started
- **Depends on:** F-076
- **MVP:** no
- **Note:** Deliberately after the MVP ships, when there is real traffic shape to test against.

#### F-080 — Order multiple items in one trade

- **Journey:** Propose & agree
- **Actor:** buyer, seller
- **Absorbs:** T-063 (todo)
- **Backend scope:** Orders and multi-item trades (M9) — several items under one escrowed trade.
- **Frontend scope:** The item steps inside the Create a Trade flow. v2 draws no screen of its own for this (gap 6), so it extends F-018's and F-019's stages rather than adding a surface.
- **Status:** Not started
- **Depends on:** F-017, F-041
- **MVP:** no
- **Note:** **Deferred 2026-11-15 by the owner**, with F-041, for the reason this note already gave.
  Split out of F-017 on 2026-11-09. It genuinely needs listings (T-056 via F-041); the rest of proposing a trade does not, and keeping them together put the entire trade journey behind the storefront.

#### F-081 — Verify your email and phone from the verification screen

- **Journey:** Account, trust & support
- **Actor:** buyer, seller
- **Backend scope:** Four `/me` routes over one service — add or replace an **unverified** email or phone and prove it with a code. Reuses the `EMAIL_VERIFICATION` and `PHONE_VERIFICATION` OTP purposes (already in the enum, previously unused), the per-destination send budget, and `applyVerificationProgress` for the level change. `GET /me` gains a `contacts` block. No migration.
- **Frontend scope:** A contact section on VF1 (`/account/verification`): a badge per channel and a code sheet for whichever is unproven. _No new screen._
- **Status:** Done
- **Depends on:** F-045
- **MVP:** yes
- **Note:** Opened and done 2026-11-18; plan `docs/superpowers/plans/2026-11-18-f-081-verify-contacts.md`. Scope is **add + verify only**, the owner's call: changing an address that is already verified stays impossible, and that is what keeps this off the account-takeover path — `start` only ever writes an unverified row, so no request here can move a contact somebody already proved. No step-up gate, unlike F-045's phone change. Found because an account registered phone-first could never reach `CONTACT_VERIFIED`: the email captured at registration was never challenged, and no route existed to challenge it afterwards, so `POST /trades/:id/send` refused with "Confirm both your email address and your phone number". The whole-branch review on opus reproduced a working exploit against a live database, as F-045's did: `start` replaces the unproven row but `issueOtp` only supersedes challenges with the SAME destination hash, so two starts left the first code live against the second address — spending it verified an address the caller never controlled, locking its real owner out of it permanently through the global verified-unique index. Closed by binding `confirm` to the challenge's destination hash, the guard `mfa.service.ts`, `staff-invitation.service.ts` and `phone-change.service.ts` already carry. The same pass fixed a NULLS FIRST ordering bug that would have stopped `ALREADY_VERIFIED` firing once a channel held two rows, added the missing `OTP_ISSUED`/`OTP_FAILED`/`EMAIL_VERIFIED`/`PHONE_VERIFIED` audit rows, and restored 15 T-039 route tests an earlier commit had overwritten. Deferred: `start` remains an authenticated 5-per-hour "send to any address I name" primitive with no step-up (now audited), and its per-destination budget is shared across OTP purposes, so it can burn a stranger's send budget — both pre-existing properties of `issueOtp`, widened by this route.

#### F-082 — One account: choose your side per trade, and the selling limit

- **Journey:** Sell on Komtru
- **Actor:** buyer, seller, merchant
- **Backend scope:** A certified merchant can buy (the sell-only rule is gone). The selling limit for an
  account without merchant status — ₦200,000 per trade and ₦2,000,000 per Lagos day, set in
  `config/fees.yaml` under `casual_sell_limit` — enforced wherever the seller commits: creating a trade
  as seller, sending it, countering and accepting. `POST /trades/preview` reports what is left today.
- **Frontend scope:** No Buy/Sell switch and no Shop, Orders or Listings tabs. Start Trade asks "Are you
  buying or selling?" and opens the buyer's or the seller's flow; the seller's flow warns over the limit
  and points to merchant status. _No new reference screen._
- **Status:** Built, awaiting staging check
- **Depends on:** F-012, F-017, F-040
- **MVP:** yes
- **Note:** Opened 2026-11-20 by the owner. Design
  `docs/superpowers/specs/2026-11-20-one-account-trade-sides-design.md`. A trade counts toward the day
  once the seller has committed to it (accepted, or the seller's own terms are on the table), on the day
  it was accepted or the seller's terms were put up; cancelled, declined, rejected, expired and
  cancelled-and-refunded trades do not count.

## 3. Coverage table

Every ticket in `docs/tickets/`, in id order, with the feature that absorbs it.

| T- id | Title                                                                     | Ticket status | Feature | Feature status               |
| ----- | ------------------------------------------------------------------------- | ------------- | ------- | ---------------------------- |
| T-001 | Cannibalization audit                                                     | Done          | F-001   | Done                         |
| T-002 | Monorepo scaffold and shared config                                       | Done          | F-001   | Done                         |
| T-003 | Local infrastructure and environment wiring                               | Done          | F-001   | Done                         |
| T-004 | CI workflows per app                                                      | Done          | F-001   | Done                         |
| T-005 | Hosting confirmation and real deploy jobs                                 | Done          | F-075   | Done                         |
| T-006 | Build-agent tooling prerequisites                                         | Done          | F-001   | Done                         |
| T-010 | `shared-types` foundations                                                | Done          | F-002   | Done                         |
| T-011 | `ui-kit` tokens, fonts and brand mark                                     | Done          | F-002   | Done                         |
| T-012 | `ui-kit` core primitives and Storybook                                    | Done          | F-002   | Done                         |
| T-013 | `ui-kit` layout shells                                                    | Done          | F-002   | Done                         |
| T-014 | `ui-kit` TrustOps patterns                                                | Done          | F-002   | Done                         |
| T-015 | `api-client`                                                              | Done          | F-002   | Done                         |
| T-016 | Visual-check harness                                                      | Done          | F-002   | Done                         |
| T-017 | Next.js app foundation                                                    | Done          | F-002   | Done                         |
| T-020 | Backend skeleton                                                          | Done          | F-003   | Done                         |
| T-021 | Database foundation                                                       | Done          | F-003   | Done                         |
| T-022 | Migration-safety check                                                    | Done          | F-003   | Done                         |
| T-023 | Redis, BullMQ and scheduler                                               | Done          | F-003   | Done                         |
| T-024 | Domain events: outbox and typed bus                                       | Done          | F-003   | Done                         |
| T-025 | HTTP cross-cutting: pagination, idempotency, rate limits, validation      | Done          | F-004   | Done                         |
| T-026 | Platform crypto and identifiers                                           | Done          | F-004   | Done                         |
| T-027 | Socket gateway                                                            | Done          | F-007   | Done                         |
| T-028 | Outbound provider calls                                                   | Done          | F-004   | Done                         |
| T-029 | Isolate the integration suite's shared Redis and queues                   | Not started   | F-005   | Not started                  |
| T-030 | Identity schema                                                           | Done          | F-011   | Done                         |
| T-031 | Sessions, tokens and principal resolution                                 | Done          | F-011   | Done                         |
| T-032 | Registration, OTP and password login                                      | Done          | F-011   | Done                         |
| T-033 | Username system                                                           | Done          | F-011   | Done                         |
| T-034 | Social login                                                              | Not started   | F-014   | Not started                  |
| T-035 | Party lookup and invitations                                              | Done          | F-017   | Not started                  |
| T-036 | Devices, MFA and passkeys                                                 | Done          | F-011   | Done                         |
| T-037 | RBAC catalog, staff login and admin endpoints                             | Done          | F-049   | Done                         |
| T-038 | Staff invitations                                                         | Done          | F-049   | Done                         |
| T-039 | Account lifecycle, recovery and NDPA hooks                                | Done          | F-045   | Backend done, UI outstanding |
| T-040 | Files and evidence (M20)                                                  | Done          | F-008   | Done                         |
| T-041 | Avatars                                                                   | Done          | F-008   | Done                         |
| T-042 | Saved delivery addresses                                                  | Done          | F-044   | Backend done, UI outstanding |
| T-045 | Notifications delivery pipeline (M11)                                     | Done          | F-007   | Done                         |
| T-046 | Location catalog: states, cities and city requests                        | Done          | F-044   | Backend done, UI outstanding |
| T-047 | Fee schedule file                                                         | Done          | F-006   | Done                         |
| T-048 | Configuration (M17)                                                       | Done          | F-006   | Done                         |
| T-049 | Trade Standards by category                                               | Done          | F-017   | Not started                  |
| T-050 | Verification core: NIN/BVN, liveness, levels                              | Done          | F-045   | Backend done, UI outstanding |
| T-051 | Business verification, bank name-match, address, social proof             | Done          | F-040   | Not started                  |
| T-052 | Duplicate identity detection and KYC review queue                         | Done          | F-051   | Done                         |
| T-055 | Merchant applications and certification                                   | Not started   | F-040   | Not started                  |
| T-056 | Listings lifecycle, images and stock                                      | Not started   | F-041   | Not started                  |
| T-057 | Search and discovery (M19)                                                | Not started   | F-015   | Not started                  |
| T-060 | Trade schema, state machine and audit                                     | Done          | F-017   | Not started                  |
| T-061 | Proposal flow                                                             | Done          | F-017   | Not started                  |
| T-062 | Proposal risk hold and TrustOps review                                    | Not started   | F-021   | Not started                  |
| T-063 | Orders and multi-item trades (M9)                                         | Not started   | F-017   | Not started                  |
| T-064 | Fulfilment: ship step, delivery signals, deadlines                        | Done          | F-026   | Backend done, UI outstanding |
| T-065 | Inspection and completion                                                 | Done          | F-027   | Backend done, UI outstanding |
| T-066 | Post-funding cancellation and can't-fulfil refunds                        | Not started   | F-030   | Not started                  |
| T-067 | IMEI verification                                                         | Not started   | F-020   | Not started                  |
| T-068 | Trade realtime, notifications and deep links                              | Not started   | F-022   | Not started                  |
| T-070 | Double-entry ledger core                                                  | Done          | F-009   | Done                         |
| T-071 | Provider adapter and Paystack                                             | Done          | F-009   | Done                         |
| T-072 | Funding a trade                                                           | Done          | F-024   | Done                         |
| T-073 | Payout accounts, preferences and payouts                                  | Not started   | F-037   | Not started                  |
| T-074 | Release and settlement                                                    | Done          | F-027   | Backend done, UI outstanding |
| T-075 | Refunds                                                                   | Not started   | F-030   | Not started                  |
| T-076 | Chargebacks, reconciliation and settlement operations                     | Not started   | F-053   | Not started                  |
| T-077 | Komtru Wallet top-up                                                      | Blocked       | F-025   | Not started                  |
| T-080 | Disputes core                                                             | Not started   | F-032   | Not started                  |
| T-081 | Evidence comparison and dispute read models                               | Not started   | F-032   | Not started                  |
| T-085 | Logistics schema and Park seed                                            | Not started   | F-065   | Not started                  |
| T-086 | Logistics auth, companies and members                                     | Not started   | F-065   | Not started                  |
| T-087 | Package pipeline and ship-to-company                                      | Not started   | F-066   | Not started                  |
| T-090 | Park schema                                                               | Not started   | F-060   | Not started                  |
| T-091 | Hub onboarding, activation and lifecycle                                  | Not started   | F-060   | Not started                  |
| T-092 | Custody operations API                                                    | Not started   | F-061   | Not started                  |
| T-093 | Park and trade integration                                                | Not started   | F-062   | Not started                  |
| T-094 | Park cash-fee notices and handover log                                    | Not started   | F-063   | Not started                  |
| T-095 | Park TrustOps read models                                                 | Not started   | F-064   | Not started                  |
| T-100 | Support tickets (M10)                                                     | Not started   | F-048   | Not started                  |
| T-101 | Risk and fraud (M13)                                                      | Not started   | F-052   | Not started                  |
| T-102 | Reputation and ratings (M12)                                              | Not started   | F-016   | Not started                  |
| T-103 | Administration: impersonation and admin action log (M14, adapted)         | Not started   | F-054   | Not started                  |
| T-104 | Audit and compliance (M15)                                                | Not started   | F-055   | Not started                  |
| T-105 | Reporting, analytics and seller insights (M16)                            | Not started   | F-039   | Not started                  |
| T-106 | Referral and growth (M18)                                                 | Not started   | F-039   | Not started                  |
| T-107 | Universal case model, work queue and advisory                             | Done          | F-050   | Done                         |
| T-108 | Trade messaging                                                           | Not started   | F-047   | Not started                  |
| T-110 | App scaffold and shells                                                   | Done          | F-012   | Done                         |
| T-111 | Entry and authentication                                                  | Done          | F-011   | Done                         |
| T-112 | First-time onboarding                                                     | Not started   | F-013   | Not started                  |
| T-113 | Home and discovery                                                        | Not started   | F-015   | Not started                  |
| T-114 | Seller profile and Trust Passport                                         | Not started   | F-016   | Not started                  |
| T-115 | Create and propose a trade                                                | Not started   | F-017   | Not started                  |
| T-116 | Buyer trade core and canonical trade detail                               | Not started   | F-022   | Not started                  |
| T-117 | Escrow funding                                                            | Done          | F-024   | Done                         |
| T-118 | Delivery, pickup PIN and inspection                                       | Not started   | F-027   | Backend done, UI outstanding |
| T-119 | Cancellation and refunds                                                  | Not started   | F-030   | Not started                  |
| T-120 | Disputes (buyer and seller)                                               | Not started   | F-032   | Not started                  |
| T-121 | Apply for merchant certification                                          | Not started   | F-040   | Not started                  |
| T-122 | Shop and listings                                                         | Not started   | F-041   | Not started                  |
| T-123 | Seller trade handling and shipping                                        | Not started   | F-026   | Backend done, UI outstanding |
| T-124 | Seller payouts                                                            | Not started   | F-037   | Not started                  |
| T-125 | Seller insights                                                           | Not started   | F-039   | Not started                  |
| T-126 | Trust, account and settings                                               | Not started   | F-046   | Not started                  |
| T-127 | Reviews                                                                   | Not started   | F-038   | Not started                  |
| T-128 | Messaging                                                                 | Not started   | F-047   | Not started                  |
| T-129 | Help and support                                                          | Not started   | F-048   | Not started                  |
| T-130 | Park Hub application                                                      | Not started   | F-060   | Not started                  |
| T-131 | Wallet top-up                                                             | Blocked       | F-025   | Not started                  |
| T-140 | Console scaffold, shell and staff auth                                    | Done          | F-049   | Done                         |
| T-141 | Work queue and universal case                                             | Done          | F-050   | Done                         |
| T-142 | Trade proposals                                                           | Not started   | F-021   | Not started                  |
| T-143 | Disputes                                                                  | Not started   | F-035   | Not started                  |
| T-144 | Identity review                                                           | Done          | F-051   | Done                         |
| T-145 | Fraud signals and restrictions                                            | Not started   | F-052   | Not started                  |
| T-146 | Settlement operations                                                     | Not started   | F-053   | Not started                  |
| T-147 | Park applications, registration and lifecycle                             | Not started   | F-060   | Not started                  |
| T-148 | Park network and custody                                                  | Not started   | F-064   | Not started                  |
| T-149 | Logistics companies and packages                                          | Not started   | F-066   | Not started                  |
| T-150 | Directory, roles and approvals                                            | Not started   | F-054   | Not started                  |
| T-151 | Support tickets console                                                   | Not started   | F-048   | Not started                  |
| T-152 | Audit and compliance                                                      | Not started   | F-055   | Not started                  |
| T-153 | Overview, configuration, notifications and analytics                      | Not started   | F-056   | Not started                  |
| T-154 | Merchant certification review                                             | Not started   | F-040   | Not started                  |
| T-155 | Location catalog management                                               | Not started   | F-056   | Not started                  |
| T-160 | Portal scaffold and login                                                 | Not started   | F-065   | Not started                  |
| T-161 | Team management                                                           | Not started   | F-065   | Not started                  |
| T-162 | Packages                                                                  | Not started   | F-066   | Not started                  |
| T-170 | App scaffold, login and hub context                                       | Not started   | F-061   | Not started                  |
| T-171 | Hub dashboard and log arrival                                             | Not started   | F-061   | Not started                  |
| T-172 | Inspection, damage and incidents                                          | Not started   | F-061   | Not started                  |
| T-173 | Safe handover                                                             | Not started   | F-062   | Not started                  |
| T-174 | Handover log, hub profile and staff                                       | Not started   | F-063   | Not started                  |
| T-180 | End-to-end critical paths                                                 | Not started   | F-076   | Not started                  |
| T-181 | Load and resilience                                                       | Not started   | F-079   | Not started                  |
| T-182 | Security review                                                           | Not started   | F-077   | Not started                  |
| T-183 | Definition-of-done audit and first push                                   | Not started   | F-078   | Not started                  |
| T-190 | Remap the screen index to Living Master v2 and re-scope the UI tickets    | Done          | F-010   | Done                         |
| T-191 | Rework T-110 shells to the v2 desktop, tablet and mode switch             | Done          | F-012   | Done                         |
| T-192 | Create a trade: buyer starts, seller completes                            | Not started   | F-018   | Not started                  |
| T-193 | Create a trade: seller starts, buyer completes                            | Not started   | F-019   | Not started                  |
| T-194 | Trade workspace supporting screens: funding, terms, agreement and payment | Done          | F-023   | Done                         |
| T-195 | Trade workspace supporting screens: delivery and evidence                 | Done          | F-028   | Done                         |
| T-196 | Trade workspace supporting screens: resolution and issue reporting        | Not started   | F-032   | Not started                  |
| T-197 | Proof media: capture, check and compare                                   | Done          | F-029   | Done                         |
| T-198 | Lifecycle exceptions and trade extras                                     | Not started   | F-031   | Not started                  |
| T-199 | Resolution execution: return track                                        | Not started   | F-033   | Not started                  |
| T-200 | Resolution execution: replacement and mutual settlement                   | Not started   | F-034   | Not started                  |
| T-201 | Resolution execution: return custody at the hub                           | Not started   | F-036   | Not started                  |
| T-202 | Seller shop settings and catalogue import                                 | Not started   | F-042   | Not started                  |
| T-203 | Seller customers, tax documents and badges                                | Not started   | F-043   | Not started                  |
| T-204 | Account basics, money documents and system states                         | Not started   | F-044   | Backend done, UI outstanding |
| T-205 | Account security and lifecycle                                            | Not started   | F-045   | Backend done, UI outstanding |
| T-206 | Park agent hub tools and hub count                                        | Not started   | F-063   | Not started                  |
| T-207 | Desktop: arrive, home and discover                                        | Not started   | F-067   | Not started                  |
| T-208 | Desktop: propose, agree and fund                                          | Not started   | F-068   | Not started                  |
| T-209 | Desktop: fulfil, deliver, inspect and complete                            | Not started   | F-069   | Not started                  |
| T-210 | Desktop: issues and resolution, messages, trust and account               | Not started   | F-071   | Not started                  |
| T-211 | Desktop: help, documents and settings                                     | Not started   | F-071   | Not started                  |
| T-212 | Tablet: arrive, home, discover, propose and fund                          | Not started   | F-072   | Not started                  |
| T-213 | Tablet: fulfil, deliver, inspect and payouts                              | Not started   | F-073   | Not started                  |
| T-214 | Tablet: issues, messages, account and help                                | Not started   | F-074   | Not started                  |
| T-215 | TrustOps: operations control, knowledge and quality                       | Not started   | F-057   | Not started                  |
| T-216 | TrustOps: governance                                                      | Not started   | F-057   | Not started                  |
| T-217 | TrustOps: treasury and communications                                     | Not started   | F-058   | Not started                  |
| T-218 | TrustOps: field audits                                                    | Not started   | F-058   | Not started                  |
| T-219 | TrustOps: people development                                              | Not started   | F-059   | Not started                  |
| T-220 | TrustOps: tablet                                                          | Not started   | F-059   | Not started                  |
| T-221 | Desktop and tablet: issues and resolution                                 | Not started   | F-070   | Not started                  |
| T-222 | Re-base TabBar to v2 mobile styling                                       | Done          | F-012   | Done                         |

## 4. Verification

Computed from `docs/tickets/*.md` by parsing every `### T-nnn — …` heading.

```
Total T- ids found in docs/tickets/ : 168
Total T- ids mapped to a feature    : 168
Unmapped ids                        : none
Double-mapped ids                   : none
Features                            : 79
Feature dependency cycles           : none
```

Per-journey totals:

| Journey                                 | Features | T- ids  | v2 screens | Done   | Backend done, UI outstanding | Not started |
| --------------------------------------- | -------- | ------- | ---------- | ------ | ---------------------------- | ----------- |
| Platform (not a user journey)           | 10       | 31      | 0          | 9      | 0                            | 1           |
| Arrive & verify                         | 4        | 11      | 16         | 2      | 0                            | 2           |
| Home & discover                         | 2        | 4       | 16         | 0      | 0                            | 2           |
| Propose & agree                         | 5        | 11      | 34         | 0      | 0                            | 5           |
| The trade workspace                     | 2        | 3       | 23         | 0      | 0                            | 2           |
| Fund & protect                          | 2        | 4       | 7          | 0      | 1                            | 1           |
| Fulfil & dispatch                       | 1        | 2       | 11         | 0      | 1                            | 0           |
| Deliver & inspect                       | 3        | 5       | 26         | 0      | 1                            | 2           |
| Issues & resolution                     | 7        | 12      | 53         | 0      | 0                            | 7           |
| Complete & grow                         | 3        | 6       | 10         | 0      | 0                            | 3           |
| Sell on Komtru                          | 4        | 8       | 27         | 0      | 0                            | 4           |
| Account, trust & support                | 5        | 12      | 44         | 0      | 2                            | 3           |
| TrustOps console                        | 11       | 23      | 66         | 2      | 1                            | 8           |
| Park network                            | 5        | 15      | 30         | 0      | 0                            | 5           |
| Logistics partner                       | 2        | 7       | 4          | 0      | 0                            | 2           |
| Desktop & tablet journeys               | 8        | 9       | 70         | 0      | 0                            | 8           |
| Launch & assurance (not a user journey) | 5        | 5       | 0          | 0      | 0                            | 5           |
| **Total**                               | **79**   | **168** | **437**    | **13** | **6**                        | **60**      |

Progress, old unit against new:

|             | Old (tickets) | New (features) |
| ----------- | ------------- | -------------- |
| MVP         | 58/112 (52%)  | 13/51 (25%)    |
| Whole build | 58/168 (35%)  | 13/79 (16%)    |

The 437 rows of `screens-v2.tsv` are accounted for as well: the 79 features carry
437 mapped v2 screens, which is every row of
`docs/design-reference/SCREEN_INDEX.md`.

## 5. Gaps found

Listed, not invented. No ticket was created and no scope was added.

1. **Location catalog management (T-155) maps to zero v2 screens.** The console needs a way to
   add cities and resolve city requests — T-046 exposes the endpoints and `docs/MVP.md` names Q16
   as blocking on which cities seed the catalog — but Living Master v2 draws no screen for it.
   Absorbed into F-056 with no frontend.
2. **The Park agent app has no sign-in screen (T-170).** U1–U6 start at the hub dashboard. The
   app needs scaffold, login and hub context and v2 does not draw them. Absorbed into F-061.
3. **The logistics partner portal has no screens at all (T-160, T-161, T-162).** Portal scaffold,
   login, team management and packages are specified in epic 15 and drawn nowhere in v2. F-065
   and F-066 are the only non-platform features with zero frontend reference.
4. **Staff login, staff MFA and staff invitation acceptance have no reference screen** — stated
   in T-140 itself. F-049 is marked Done on that basis; the screens were built without a
   reference.
5. **Referral and growth (T-106) has no screen anywhere in v2.** It is backend-only and deferred.
   Parked inside F-039 rather than given a surface this document would have had to invent.
6. **Multi-item orders (T-063) has no screen of its own.** The item steps live inside v2's
   Create a Trade flow and the only order-level screen is Active Orders (AC8), owned by T-123.
   Absorbed into F-017 so the proposal backend ships whole.
7. **`tools/tickets/progress.py` over-counts the MVP by three.** `mvp_ids()` regex-scrapes T- ids
   out of `MVP.md`'s Included prose, so it picks up T-201, T-210 and T-214 from the sentences
   that say they are _deferred_ ("Return custody at a hub (T-201) stays deferred"; "split out of
   T-210 and T-214"). The real cut is 77 included, making the old MVP target 109 rather than 112
   and the old percentage 53% rather than 52%. This document uses the prose cut, so F-036, F-071
   and F-074 are marked MVP **no**.

## 6. Features that were hard to place

- **The trade workspace (F-022).** v2 collapsed 14 v1 trade screens into one tabbed, role-aware
  surface of 9 screens with 18 supporting sheets, 4 funding/terms screens, 4 lifecycle
  exceptions, 8 proof-media screens and 5 trade extras — 48 screens, four or five cycles in one
  journey. It is split along the seams the reference itself uses: the workspace shell (F-022),
  terms and payment (F-023), delivery and evidence (F-028), proof media (F-029), resolution
  sheets (inside F-032) and lifecycle exceptions (F-031). Each is one cycle and each has a
  distinct backend owner.
- **Dispute decisions (F-035).** T-143 is a console ticket, but putting it in the TrustOps
  journey would reproduce the exact failure this re-plan fixes: a dispute a buyer can open and
  nobody can decide. It sits in Issues & resolution, with staff as the actor.
- **Desktop and tablet (F-067–F-074).** These look like a layer, and they are the one place the
  layer shape survives. It survives because v2 draws them that way: Desktop · 01–11 and
  Tablet · 01–11 are whole-journey layouts, not responsive variants of individual screens, and
  T-190 already scoped the tickets that way. Each feature is named for the journey it covers, so
  the mobile journey and its wide layout are adjacent in build order rather than in separate epics.
- **The ledger core and reconciliation (F-009, F-053).** The temptation is to call F-009 "Pay for
  a trade" and F-053 "Get your money back". Neither is true: the ledger has no screen and
  reconciliation is a staff tool. F-009 is a platform feature; F-053 is a console feature. Being
  honest about this is cheaper than a feature whose definition of done nobody can demonstrate.
