# Build manager run log

Append-only. Each build-manager run adds one entry at the bottom, following
[`MANAGER.md`](MANAGER.md) step 5. The manager reads the last few entries to estimate ticket
cost and to find work to resume.

## Waiting on the owner

- **Inspection windows are published on the marketing site but encoded nowhere** (new 2026-11-19, from the web-site phase-2 build). The twelve public pages were ported from `Komtru website v4.2.html`, and the reference states per-category inspection times as fact: **Electronics 48 hours (up to 72), Fashion & Luxury 24 hours (up to 48)**; the clock starts on delivery, or **12 hours after arrival at a motor park**; a buyer and seller have **48 hours** to settle a reported problem directly. Nothing was guessed — these are the reference's own numbers, shipped verbatim per the "ship the documented default" rule.
  - **But no config encodes them.** `docs/specs/module-07-trade-management.md:206` has `inspection_window_hours integer NOT NULL DEFAULT 72, -- default; M17 may override per category`, and `config/fees.yaml` carries no inspection table at all. So komtru.com will publish category windows the product cannot currently honour, and 72h is the only value the schema knows.
  - **Corroborating split inside our own copy:** `src/site/faq.ts` (`HOME_FAQ`) and the Help page answer the same question — "How long do I have to check the item?" — differently. The home answer ends "and you can ask for more"; the Help answer names the 72/48 caps. Both are now live on the site.
  - **Question for the owner:** are 48h/24h the intended M17 per-category overrides, and should they move into a config file the way fees did? Until that is answered the site states a policy the backend does not implement. **Not a deploy blocker for staging; it is one for komtru.com.**

- **The seller model, as the owner settled it on 2026-11-19.** Stated here once because it now shapes several features, and three separate agents built against the wrong version of it today. **Fold this into `FEATURE_MAP.md` and the module specs at the next merge** — this log is where it was captured, not where it belongs.
  - **Every account is both a buyer and a seller.** There is no "become a seller" step, and no screen may offer one. The create-a-trade form must let the creator say whether they are the buyer or the seller in that trade (backend already supports it; see the F-040 entry).
  - **Merchant status is earned** by verifying CAC and the rest of the business documents, through Account › Verification › Merchant verification.
  - **Merchant status unlocks exactly two things:**
    1. **Trades above the per-trade cap.** The cap is per trade. A trade worth more than the cap requires the _seller_ to hold merchant status, so a buyer creating an over-cap trade against an unverified seller is blocked. Cap value and its home: see the F-040 entry.
    2. **Listing products for discovery.** Only merchants may list. Everyone else transacts one trade at a time, party to party, with no catalogue.
  - **Consequence for F-041 (List items and manage stock, deferred 2026-11-15):** merchant status is a hard precondition, not a soft one. Its `Actor: merchant` line already implied this; it is now an invariant to enforce, and the discovery surfaces (F-015, F-016) must only ever show merchant listings. Nothing is mis-built today — no listings table or module exists yet, so there is nothing currently ungated.

- **F-032, two defects found after merging, both by actually running the thing.** Neither was visible to 22 component tests, an axe pass, or a green CI.
  - **BLOCKING, money — a withdrawn dispute strands the trade in `DISPUTED` for ever.** `withdrawDispute` closes the case (`moveCase` plus an audit row) and never touches the trade, and `trades/domain/stateMachine.ts` has no exit from `DISPUTED` except `RESOLVE_DISPUTE → RESOLVED_REFUNDED | RESOLVED_RELEASED`. So after a withdrawal the trade can never settle, never complete, and never be disputed again, with the money still held. The integration test `allows a second dispute once the first is closed` asserts the behaviour we presumably want and is **skipped** with this reason in the file; un-skip it once decided. **What should withdrawing a dispute do to the trade — return it to `INSPECTION` (a new `WITHDRAW_DISPUTE` transition), resume the inspection window where it left off, or is withdrawal simply not allowed once a case is open?** Not guessed: it decides where held money goes.
  - **FIXED — all five dispute routes crashed in a real browser.** Each page is a server component that passed `render={(disputeId) => …}` into `WithDispute`, which is `'use client'`; React cannot serialise a function across that boundary, so `issue`, `dispute/status`, `dispute/evidence`, `dispute/withdraw` and `appeal` all threw "Functions cannot be passed directly to Client Components" before rendering anything. The whole user-facing half of F-032 was dead on arrival. Fixed on `f-032-rsc-fix` by replacing the function prop with a serialisable `screen` discriminant and a `CASE_SCREENS` map inside the client module; pages keep their `metadata` export. Verified in a real browser: Y1 and CWT-S15 now render content (10.11% and 9.80% against the reference), and the earlier scores of 12.27% and 12.49% are void because they were measured against the error card. A grep confirmed no other page in any app passes a function across that boundary.
  - **Note on the two voided scores:** a deviation percentage means nothing without knowing what was on the page. Both were recorded in good faith against a screen that had crashed.

- **F-032 report an issue and open a dispute** (on branch `f-032-disputes`, not merged; plan `2026-11-19-f-032-disputes.md`). Both layers built in one cycle: backend complete, 12 of 15 screens, 13 commits, migrations `0054_disputes_schema` and `0055_disputes_triggers` with `migration:safety` clean (56 migrations, 216 invariants, 0 errors). **Three money questions, the first one blocking:**
  - **ANSWERED 2026-11-19 — commission comes from the seller.** When a dispute splits an item, the platform's commission is taken out of the **seller's** share, not the buyer's and not pro rata. So `assertSplitSums`' three shares resolve as: buyer's awarded amount is paid whole from escrow, and commission is deducted from what remains to the seller. F-033 and F-034 are unblocked. The question was: M3 D4 says the two decision amounts sum to the escrowed total, the ledger's `assertSplitSums` wants three shares, and T-070 says no fee rule is decided in the ledger. F-032 stored and emitted M3's two amounts without guessing, which was right; the executing feature now has its rule.
  - **new:** does `total_escrow_minor` mean the item only, or the item plus the buyer-protection fee? M3 says "total escrowed amount"; the ledger holds them as two liabilities and settles against the **item**. The item is snapshotted and the column comment says so. Confirm.
  - **new:** reviewer exclusion ships **inert**. T-080 requires excluding reviewers who share a device or payout instrument with a party; identity and the ledger expose no such signal. The rule is written and fully tested in `domain/assignment.ts`, but the adapter returns empty lists. Shipping a written-but-dead conflict-of-interest rule should be a knowing decision, not a discovery.
  - **new, needs a product call:** CWT-S16, CWT-S17 and CWT-S18 ship as **honest placeholders**, not screens. They are per-item dispute views; a trade is one item, the orders module is not built and `orderId` is always null, so every number they would draw ("Item 2 / 2", "Confirmed · released" per item) is a financial claim nothing can back. Each says multi-item orders are not in the app yet and offers the whole-trade report instead. Agree, or build them against F-080?
  - **new:** four different reason vocabularies exist across C7, DI-01, CWT-S14 and CWT-S17. DI-01's was made canonical. Two of its options ("Arrived damaged", "Not as described") file under one category because M3 has no damage category.
  - **new:** Seller-8's reference nudge copy was **not** shipped as written — "Buyers who receive a clear, evidence-backed response within a few hours are far more likely to accept a reshipment" is an unbacked statistical claim. T-197 shows this class of copy being rewritten before.
  - **note, not a question:** `noDisputes` in `trades/services/inspectionPorts.ts` now reads real cases, so inspection and auto-release correctly stop for an open dispute. Three invariants are enforced in Postgres rather than a service: one active case per trade, one open mediation offer per party, and a BEFORE INSERT trigger refusing decisions that do not sum to escrow.
  - **still owed:** `pnpm visual-check` not run (needs a canned platform stand-in that does not exist in the repo); deviation records written at `docs/ui-review/T-120/README.md` and `T-196/README.md` with the pixel pass marked "Not yet assessed" rather than invented. 19 integration tests written and confirmed skipped, unexecuted by instruction.
  - **merge watch:** `packages/ui-kit` gains `TextArea` (+57 lines, purely additive, nothing existing modified) because the reference draws `.m-textarea` on five F-032 screens and ui-kit had no multiline control. Workspace files touched: `states/Ending.tsx`, `workspace-state.ts`, `workspace-copy.ts` — check against `f-068-f-072-propose-fund`, which modified `TradeScreen.tsx` next door.

- **F-040 seller certification UI, T-121** (on branch `f-040-seller-onboarding`, not merged; plan `2026-11-19-f-040-seller-onboarding.md`). All 7 frontend screens built (SO1–SO5, M2, BVR1), 11 commits, whole-repo turbo 40/40 and prettier clean, every screen suite ending in an axe check. Two things stop it being Done, and three need a decision:
  - **ANSWERED 2026-11-19, and it re-scopes the feature. There is no such thing as "becoming a seller."** Every account is already both buyer and seller. What a verified business gains is **merchant** status, earned by verifying CAC and the rest; an unverified default seller can sell but is **capped on how much they can transact** until they become a merchant. Consequences:
    - The entry point is the **Verifications tab of the account** (M2, already built) — not a new Account row, not a Shop tab, and not a "Become a Seller" call to action anywhere.
    - SO1–SO5's framing and copy are wrong as built. They are the **merchant verification** flow, not a seller signup. SO5's "your shop is live" and the "Become a Seller" headings need rewriting to match.
    - **New work this implies, not in F-040:** (a) a transaction cap on unverified sellers, lifted by merchant status — a money rule, see the open question below; (b) the create-a-trade form needs a control letting the creator choose whether they are the **seller or the buyer** in that trade, which today it assumes.
    - **(b) is frontend-only — the backend already supports it, checked 2026-11-19.** `createProposal` in `apps/backend-api/src/modules/trades/services/proposal.service.ts` already takes `input.role` of `'BUYER' | 'SELLER'`, writes `initiatorRole`, and assigns `buyerUserId` or `sellerUserId` from it, with a `refuseMerchantBuyer` guard on the buyer path. The UI is what assumes: `apps/web-app-ui/src/trade/create/BuyerStart.tsx:209` hardcodes `role: 'BUYER'` at creation. (`CompleteRequest.tsx` sends `'SELLER'`, but that is the seller _completing_ a buyer's request, not initiating one.) So this is a create-flow UI ticket, not a backend one. **Do it after `f-068-f-072-propose-fund` merges** — that branch reworked the same create screens and would conflict.
    - **ANSWERED 2026-11-19 — the cap is PER TRADE.** To service a trade worth more than the cap you must hold merchant status. A buyer creating a trade naming an unverified seller, for an amount over the cap, is **blocked** — so the check is on the seller's merchant status at proposal time, on both creation paths, not only when the seller initiates. The owner asked for the value to live somewhere easily updatable, anticipating a TrustOps tool for managing caps and limits.
    - **Where it belongs, checked 2026-11-19: the existing `config` settings table, not `config/fees.yaml`.** `apps/backend-api/src/modules/config/domain/settings.ts` is a typed, bounded, runtime-editable settings store (`SEED_SETTINGS`, `validateSettingValue`, INTEGER with inclusive `min`/`max`), and it already has a `trades` namespace holding exactly this shape of value (`payment_deadline_hours`, `delivery_deadline_days`). `fees.yaml` is the wrong home: it is versioned-and-deployed by design, and a cap is a limit, not a price.
    - **The TrustOps tool the owner anticipates already has its backend.** `config/http/admin.routes.ts` exposes `GET/PUT /admin/config/settings/:namespace` under STAFF scope with `config.view` and `config.manage` already in the RBAC catalogue (T-037), plus a change log. Managing caps and limits needs a _screen_, not a new service.
    - **Naming trap for whoever implements it.** `looksLikeFee()` in that same file deliberately refuses any setting whose name reads as a fee, commission or cut, to stop a fee being typed into an admin screen and bypassing §6.5. It matches the substring `kobo`, so a key like `..._kobo` would be **rejected at seed time**. Name it with the `_minor` suffix the rest of the codebase uses, e.g. `trades.unverified_seller_max_trade_amount_minor`. A cap is not a fee and otherwise passes the guard cleanly.
    - **Sequencing:** enforcement belongs in `createProposal` (`trades/services/proposal.service.ts`), which already knows `input.role` and both party ids. Do it after `f-032-disputes` merges — that branch also touches the trades module.
  - **REFRAMED 2026-11-19 to match the owner's model** (3 further commits, `0257fb5a`, `bcee4848`, `6eb68e61`). "Become a Seller" is gone from every screen. Routes moved from `/sell/*` and `/shop/verification` to `/account/verification/merchant/*` — neither old path had ever shipped, so no redirects were needed. The entry point is now Account › Verification › "Merchant verification", with a path in from every state: not started, draft (resumes at the first unfinished step), changes requested (each change links to its step), rejected (BVR1 → SO3, a fresh draft since REJECTED is terminal), approved (→ SO5). SO5 is "You're a verified merchant", not "your shop is live". **This closes the no-entry-point blocker.** `rules.ts` turned out to be keyed on application status rather than on any "is a seller" flag, so the wrong model lived almost entirely in copy — only the BVR1 "Trade as an individual seller / Unaffected" row encoded it structurally. The reference's wording was overridden in six places, each recorded in `docs/ui-review/T-121/*.md`.
  - **Doc drift the orchestrator must fix at merge:** `docs/tickets/13-web-app-ui.md` T-121 and the `#### F-040` entry in `FEATURE_MAP.md` still say "Become a Seller (SO1–SO5)" and name the old routes, and the plan `2026-11-19-f-040-seller-onboarding.md` still shows `/sell/*`. The agent correctly left all three alone rather than editing shared ticket docs from a branch.
  - **new:** the reframed copy states that a default seller's transacted amount is limited until the business is verified, **without a figure**, since the cap is answered (per trade) but its value is not. Confirm the wording before the cap ships.
  - **new:** while an application is in review the backend 409s on every edit, so M2 offers only "Contact support". Should there be a read-only view of what was submitted?
  - **new:** is the Verifications-list row the right entry, or should M2 _be_ the Verifications tab itself?
  - **new, cosmetic:** the step counter still reads "n / 5" as the reference draws it, though the flow is four steps plus an outcome.
  - **blocking the epic 13 bar — the visual check did not run.** Every route sits behind a sealed session and the data-backed screens need the platform API, which needs the backend infra this agent was told not to start. Deviation lists exist at `docs/ui-review/T-121/*.md`, each marked "visual check not run"; pixel comparison and heat maps are outstanding. Same gap as F-068/F-072 this round.
  - **still open: the bank name-match.** T-055's criterion remains unmet, so no match runs at submit. SO4 keeps the reference banner "Must match your verified name…" verbatim, but nothing checks it; the resolved account name is shown so the seller can see it themselves. Needs the sign-off the T-055 note in `docs/tickets/06-merchant-search.md` asks for.
  - **new:** confirm the reference deviations are acceptable. The backend requires fields the reference does not draw (registered address, state, city on SO1; status report or memorandum and director ID on SO3 — submit 422s without them), the SO1 phone field is undrawn because the application has no phone to save it to, CAC is mandatory with "Skip for now" removed, and SO3/SO4's primary actions are renamed because submit needs the payout account first.
  - **new:** rejection is terminal on the backend, so BVR1's "Resubmit CAC details" starts a fresh application and the seller re-uploads every document. Is that the intended cost of a rejection?
  - **new:** no route guard on SO1–SO3 once an application is in review or approved; the backend 409s on a save. Redirect, or leave it?
  - **merge watch:** one shared line, `export * from './merchant.js';` in `packages/api-client/src/react/index.ts`. Nothing else outside `src/sell`.

- **F-068 / F-072 desktop and tablet propose, agree and fund** (on branch `f-068-f-072-propose-fund`, not merged; plan `2026-11-19-f-068-f-072-propose-fund.md`). Built as one responsive pass because the screen index pairs DX-10/TX-07, DX-10B/TX-07B and DX-15/TX-10 as the same screen at two widths. 8 of 20 screens built, none visually checked. Three backend gaps block specific screens:
  - **O2 again, found independently.** DX-13's "Your proposal" column cannot be drawn because superseded terms versions' amounts and specs are on no route. This is the same gap F-023 logged as O2 — a second feature has now hit it. A `GET /trades/:id/terms/versions` would close both.
  - **new:** DX-12's "Buyer evidence" panel needs the counterparty's completed-trade count, fulfilment rate and disputes. `TradeView` carries only display name and handle. Should it carry counterparty trust facts, and is showing them to the other party the right call?
  - **new:** a proposal has no linked listing, so DX-12's "Your listing" comparison column has nothing to compare against. Does a proposal need a listing reference?
  - **new:** the reference copy differs from the shipped mobile copy in several places ("Review and send to buyer", "Accept proposal — confirm these terms as written", the stage names). The agent kept the mobile copy so existing suites stayed green. A copy pass against the reference needs the owner's call on which wins.
  - **not done, not blocked:** DX-13, DX-14/TX-09, DX-16, DX-17, TX-01, TX-05, TX-06. DX-14/TX-09 was left because `AwaitingFundingBody` sits in `src/trade/workspace`, owned by the parallel F-032 agent this round. TX-06's seller profile lives in `app/passport`, outside the feature's area.
  - **merge watch:** `src/trade/TradeScreen.tsx` wraps `AnswerProposal` in `ProposeWorkspace`; check it against the F-032 branch with `git merge-tree` before merging either.

- **F-044 account basics and system states** (merged 2026-11-17; plan `2026-11-17-f-044-account-basics.md`). Reviewed with no must-fix items. Four questions, none blocking; the reviewer's answer to each was "not yet, and that is fine", because each needs backend that does not exist:
  - **new:** should the backend add a minimum client version and emit 426 with problem code `UPGRADE_REQUIRED`? **SP-M15 is built and wired but can never fire until it does**, and is labelled NOT LIVE in `docs/ui-review/T-204/SP-M15.md`.
  - **new:** should there be a real incident feed behind SP-M14 (message, cause, affected trades)? Today it only reports whether the platform answered. Build one only when ops will publish incident text.
  - **new:** SP-M17 and SP-M19 offer no "Contact support" to a signed-out person, which needs SP-M06 / T-129. Recovery and the account's support reference are offered where they can be.
  - **new:** should Statements add "Trades and payments" or a PDF? Both need backend first — there is no route listing a buyer's payments, and no server-side statement service. CSV over payouts and refunds for now.
  - **tracked follow-ups, not blocking:** the 503 strip flaps when unrelated queries succeed; SP-M16 misses a cold return with a lapsed cookie (middleware cannot tell expired from never-signed-in, though it could tell "cookie present but unreadable"); an inactive saved city blocks unrelated edits to that address; `/status` shows loading rather than the offline hero if the device drops after load; the trade action screens keep their own 404 panel instead of SP-M19.
  - **note:** commit `f405a97` is titled `docs(ui-review)` but carries the `SystemHero` code change. Not rewritten, recorded here.

- **F-045 phone-number change** (merged 2026-11-17; plan `2026-11-17-f-045-account-security.md`). SP-M05 had no backend, so the owner asked for one and F-045 grew a three-step change-number flow. Two opus security reviews reproduced three real defects against a live database; all are fixed and re-verified. Decisions taken and still open:
  - **answered:** starting a change requires step-up, satisfied by **any** active factor (the owner declined "strongest factor", so an account holding TOTP can still move its number with an SMS code).
  - **answered:** SMS second factors are **revoked, not moved**, on a change; if that leaves no second factor the backup-code sheet is revoked too.
  - **answered:** the chained-alarm redirect is closed with a **15-minute cooldown** after a completed change, not by pinning the notice to the retired row id. The reviewer called the pinned id the architecturally correct fix; the cooldown was chosen as cheaper and needs no migration. If back-to-back changes ever become a legitimate need, this is the thing to revisit.
  - **declined:** revoking other sessions on a number change, which `password.service.ts` already does for a password change. Logged deliberately so it is not read as an oversight.
  - **new:** no middleware redirects a suspended or locked account to AS1/AS2, so those screens are reachable only by link. Should a feature add the redirect?
  - **new:** there is no UI to add an SMS second factor once TOTP is on (`useEnrolSms`/`useActivateSms` exist and are unused). Accepted scope cut — should a feature add it?
  - **new:** `/me` returns no phone number and no password-changed date, so SP-M05 cannot prefill the current number and SP-M04 has no Password row. Should `/me` carry them?

- **F-023 / F-028 / F-029 workspace screens** (all merged 2026-11-13; plans `2026-11-13-f-023-workspace-terms.md`, `-f-028-workspace-delivery.md`, `-f-029-proof-media.md`). Built by a second session alongside the manager's own F-037 run. Four questions, none blocking; every gap is drawn as a documented deviation:
  - **new:** **no party-facing call attaches an uploaded file to a trade or case by event category.** `/files/upload-url` and finalize exist but link nothing to a trade, and the `cases.ts` endpoints are STAFF-scoped. So F-028's CWT-S13 evidence submit is a seam ("Not in the app yet", no picker), and S12's Delivery and Inspection groups read "No files recorded". A reviewer confirmed the gap independently. Should a backend ticket add that call, plus a media-list read by event? **Answered 2026-11-17: yes, and shipped the same day.** The owner's shape is upload first through the existing Cloudinary-backed files endpoint (`/files/upload-url` → direct upload → `/files/:id/finalize`), then attach the resulting file to the evidence. `POST /trades/:id/evidence` and `GET /trades/:id/evidence` now do that over the append-only `trade_evidence_media` table (migration 0051), with the counterparty grant inside the attach transaction. **F-028 is Done.** Three further owner answers taken in the same pass: dispatch is seller-only and inspection buyer-only (deviates from the reference's "Both"); issue evidence attaches to the trade, and a later case link must use a new link table, never an UPDATE; a finished trade stays closed to new evidence. Video was dropped from CWT-S13 because `ALLOWED_CONTENT_TYPES` has no video type — widening it is its own feature.
  - **new:** **no funding deadline on the trade.** `tradeViewSchema` carries no expiry, the `trades` table has no `funding_deadline_at`, and nothing sweeps `PENDING_PAYMENT` to `EXPIRED` (the only `EXPIRE` caller returns early unless the status is PENDING_COUNTERPARTY). So F-023's TW-01 draws no countdown and no "six hours" copy, and **EX-01 is built, tested and unreachable** — every EXPIRED trade has `acceptedAt === null`, so `TradeScreen` always takes the `Closed` branch. Should a feature add the deadline and the sweep? (O1)
  - **new:** **no versions read.** `trade_terms_versions` holds `versionNumber`, `proposedByUserId` and `itemAmountMinor`, but every read is single-row by `currentTermsVersionId` and no route lists them. CWT-S02 now draws who proposed each version and when, from `GET /trades/:id/activity`; **earlier versions' amounts stay hidden.** Should a `GET /trades/:id/versions` exist? (O2)
  - **new:** **should the buyer see the seller's proof media before the item ships?** This is an access-control decision, so nothing was changed. The buyer **already holds the file grants** — `grantProofToBuyer` runs after send and counter, not only on acceptance — but no read lists the file ids: `TradeView` carries only `proofMediaCount`, and `getInspection` returns `sellerProof.media` empty until `EVIDENCE_VISIBLE`, which starts at SHIPPED. So F-029's PM-5 shows a count and an explanation instead of the media. Either expose the ids on `TradeView` or relax the gate for the buyer; the component renders them as soon as a read exists.
  - **answered from the docs, not asked:** no wallet payment method on CWT-S03 — F-025 is deferred and Q3's default is a disabled flag with no wallet ledger.
  - **defaults taken:** F-028 renders the self-arranged delivery path only (Park/F-062 deferred), its S08 checklist is advisory rather than a gate, and F-029's PM-1–PM-4 are steps inside the send/accept/counter flows rather than routes, because the platform attaches proof only at those points.
- **F-037 viewer seam defaults** (merged 2026-11-13; listed in `docs/superpowers/plans/2026-11-13-f-037-viewer-seam.md`):
  - **new:** "has sold" means being the seller on a COMPLETED, SETTLED or RESOLVED_RELEASED trade. Funded, in-flight and refunded sales do not count. Is that the right line?
  - **new:** the viewer's facts are only as fresh as the last token refresh. A seller whose first sale has just completed sees Payouts after the next refresh, not at once. Is that acceptable?
  - **new:** `certifiedMerchant` is now real, so a certified merchant's shell is locked to Sell (design §6.3). `parkAgent` stays `none` until T-091.
- **F-030 / T-066 / T-075 refund and cancellation defaults** (on branch `f-030-cancel-refund`, not merged; listed in `docs/superpowers/plans/2026-11-11-f-030-refunds-backend.md`):
  - **new:** the reference screen's 12-hour auto-approve of a cancellation request is in no spec, so it is not built. Should it be?
  - **new:** "Contest" is a plain decline, with no TrustOps hold. A declined request cannot be asked again.
  - **new, safe defaults:** a failed refund returns the money to escrow, with no automatic or admin retry yet. A refund call that fails or gets no answer is never re-sent; after 1 hour with no webhook it goes to review, and one still pending after 7 days goes to review. If the trade's fee terms say the fee is not refundable, the fee is booked as revenue when the refund is decided. A hold blocks cancel and refund. The platform absorbs Paystack's refund processing fee.
- **F-030 refunds backend, review-fix questions** (merged 2026-11-12):
  - **new:** a hold placed after a refund is decided keeps the refund unsent until the hold is lifted (safest default). Should a fraud or compliance hold block a refund that is already decided?
  - **new:** a trade with a requested refund whose books don't match its snapshot is retried every 5 minutes and logs an error each time. Should it back off, or open a case (T-076)?
  - **new:** how should a failed refund be recovered: a new refund against the same charge, or a manual payout to the buyer? (deferred to T-076)
  - **new:** T-074's release has no re-drive after a hold is lifted. The fix covered refunds only.
- **F-019 / T-193 seller-starts defaults** (merged 2026-11-12; listed in `docs/superpowers/plans/2026-11-12-f-019-seller-starts.md`): no listings exist, so the seller types the item name and price. The buyer's address on file is not shown on CT-S1. The delivery charge and partner work as in F-018. Park is "Coming soon" for the buyer.
- **F-018 / T-192 create-a-trade defaults** (merged 2026-11-11; listed in `docs/superpowers/plans/2026-11-11-f-018-create-trade.md`):
  - **new:** a buyer's request stores required item fields as "Seller to confirm" until the seller completes it. Funding and accept are blocked while any remain. Should the platform accept a proposal with the item spec left open?
  - **new:** the delivery charge is held in the item spec, shown as "paid to the seller outside Komtru protection", and is not in the funded total or the fee snapshot. Should it be?
  - **new:** there is no delivery-partner catalogue, so the seller types the partner and the charge. Which partners are approved, and at what cost?
  - **new:** the item category is found by keyword match, with a picker as the fallback. Should the platform detect it?
  - E2E is waived for T-192 because the repo has no end-to-end harness (F-076).

- **F-013 / T-112 onboarding defaults** (merged 2026-11-11; listed in `docs/superpowers/plans/2026-11-11-f-013-onboarding.md`):
  - **new:** the backend sends push through FCM, but the repo has no Firebase web config, SDK or messaging worker. OB4 asks for browser permission and registers no device until a web token source is added. Should a feature add Firebase web push?
  - **new, defaults:** returning users on a new device do not see the walkthrough; Skip on OB1–OB3 also skips the notification ask; there is no replay link in Account; OB5 greets by the first name typed at sign-up (no profile read exists).
- **F-037 / T-124 payouts UI** (merged to `main` 2026-11-11; listed in `docs/superpowers/plans/2026-11-11-f-037-payouts-ui.md`):
  - **new:** the Payouts row in Account shows only when `viewer.hasSold` is true, but `resolveViewer` still returns the anonymous viewer, so nothing links to `/account/payouts` yet. The UI is now merged (2026-11-11), but F-037 stays `Backend done, UI outstanding` until this is answered. Should a feature fill the viewer seam before F-037 counts as Done? **Answered 2026-11-12: yes.** Fill the viewer seam (`resolveViewer` returns the signed-in viewer, including `hasSold`) as the closing work of F-037, which is in-flight work: resume it first. F-037 is Done once a seller can reach `/account/payouts` from Account.
  - **new:** should PR1 offer "Download receipt (PDF)"? It needs a backend route, which does not exist yet.
  - **new:** AB5 makes no arrival-time promise (the reference's "within 2 hours, always within 24" was dropped). Should it promise one, and from what source?
- **F-037 / T-073 payout defaults** (merged to `main` 2026-11-11; listed in `docs/superpowers/plans/2026-11-11-f-037-payouts-backend.md`):
  - **new:** T-051 says a fuzzy name match "is not a pass", but decision 3 accepts it for a payout account. Decision 3 was kept. Should a fuzzy match hold the account for a person instead?
  - **new, safe defaults:** a payout to an account no longer verified, or one under a hold, is returned to the balance before any send. A transfer still not final after 24h goes to NEEDS_REVIEW. A mismatched verify (reference, amount, currency or transfer code) goes to NEEDS_REVIEW and nothing posts. A succeeded payout later verified as failed is only logged. A failed sweep payout keeps that day's sweep key, so its money goes out on the next due sweep. Payouts are NGN only;
  - the payout fee is credited to `PLATFORM_FEE_REVENUE`;
  - a failed payout returns the payout fee too;
  - the name-match rule for casual (non-business) sellers is open, because T-051 only matches business names;
  - an instant payout whose balance no longer covers it is skipped, never partially paid;
  - the scheduled sweep runs at 09:00 Lagos time;
  - there is no minimum or maximum payout;
  - a hold found just before the transfer goes out cancels the payout.
- **F-027 defaults** (merged 2026-11-11):
  - BEI1 asks for more inspection time during inspection, as the backend built it, not with the proposal as the reference draws it. The choices are 12 h, 24 h or one more window.
  - BEI2 has accept and decline only, with no counter.
  - The Z5 release amount is the item amount.
  - The DE1 date is a datetime field, capped by the platform.
  - DE3 has no refund button, because the platform refunds on its own (F-030).
- **F-026 defaults** (merged 2026-11-11): Seller-3's optional courier/tracking/photo form is replaced by X2's four required fields (waybill, receipt photo, driver phone, plate), because the backend requires them; AC8 reuses `TradeRow`; `/orders` now shows AC8 in place of the DX-18 placeholder (T-209 may revisit).
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

- **F-051 identity review console** (merged 2026-11-10; details in `docs/superpowers/plans/2026-11-10-f-051-identity-review.md`):
  - Which role should hold `verification.override`, so it can approve duplicate-flag clearances? The console offers
    "Approve this clearance" to any holder, and the backend enforces it.
  - Should the KYC decide route have a "request more information" outcome? Today it takes only approve or reject,
    so analysts ask for evidence on the universal case instead.
- **F-024 escrow funding** (merged 2026-11-10; details in `docs/superpowers/plans/2026-11-10-f-024-fund-escrow.md`):
  - Money that lands on a cancelled, expired, unknown or amount-mismatched trade is not refunded. It publishes
    `trades.funding.review_required` and writes an internal activity row, but nothing consumes the event yet.
    Should it open a case automatically, and should T-076 reconciliation own it?
  - The reference has no drawing for a payment under review. It is built as a plain "We're checking this payment"
    screen. Should design draw it?
  - Should the trade view return the Buyer Protection Fee rate, so V1 can print "(1.5%)" as drawn? Today it shows
    only the amount.

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

## 2026-11-09 18:13 WAT — run summary

- Usage at start: 5h 11%, week 91%. At end: 5h 11%, week 91%.
- Capacity: 0. skipped: budget (5h 11%, week 91%). Weekly usage is past the 85% owner reserve;
  it resets 2026-11-10 14:59 WAT. No in-flight worktrees or ticket branches to resume.
- Tickets: none.
- Next: once the weekly window resets, a full `KOMTRU_INFRA_TESTS=1` run on `main` (still owed from
  the T-052/T-072 merges), then the ledger critical path T-064, T-073, T-074, T-075.

## 2026-11-09 21:13 WAT — run summary

- Usage at start: 5h 12%, week 91%. At end: 5h 12%, week 91%.
- Capacity: 0. skipped: budget (5h 12%, week 91%). Weekly usage is past the 85% owner reserve;
  it resets 2026-11-10 14:59 WAT.
- Features: none started or resumed. Two worktrees exist, `f-017-propose` (UI layer, 6 commits, uncommitted
  visual-check edits) and `f-022-workspace` (backend realtime and notifications, migration 0047). Both had
  commits within the last few minutes, so another session is working on them now, and this run left them alone.
- Next: after the weekly reset, if those sessions are no longer active, review and merge F-017 and F-022
  (they are in different apps/modules, and only F-022 adds a migration). Then the full `KOMTRU_INFRA_TESTS=1`
  run on `main` that is still owed.

## 2026-11-10 22:27 WAT — run summary

- Usage at start: 5h 1%, week 0%. At end: 5h 68%, week 10%.
- Capacity: 2 (est 22, est_week 3). Features: F-051 (merged, Done), F-024 (merged, Done). Both were
  **Backend done, UI outstanding**. They ran in parallel in separate apps; neither added a migration.
- F-051 (sonnet): OP-05 queue and flags, plus the OP-06 verification case in operations-app. The review found
  the console unusable against the real API, because `GET /admin/me` did not exist. The fixer added it to the
  backend identity module (no migration) and a clearance-approval panel for `verification.override` holders who
  don't own the case, because self-approval is refused. Review: 9 items fixed.
- F-024 (opus, money): V1/V2/V3/AB3/AB4 in web-app-ui, plus a backend gap closed: no code moved a paid trade
  from PENDING_PAYMENT to FUNDED. `fundTrade` now subscribes to `ledger.payment.escrow_funded`. It is idempotent
  and checks the amount, and late or mismatched money goes to review, never auto-refunded. Review: 13 items fixed.
  Paystack Inline is untested against a real Paystack account.
- Verification: package build, then lint, typecheck and test for backend-api, api-client, web-app-ui, ui-kit,
  shared-types and operations-app (22/22) on each branch and again on `main` after each merge. Format check clean.
  The fixers ran `KOMTRU_INFRA_TESTS=1` on their branches. The manager's runs on `main` were the default suite,
  so the full infra run on `main` is still owed.
- Feature costs, together: 5h-cost=67 week-cost=10, so about 34 and 5 each. F-024 cost the most (opus).
- Next: the remaining **Backend done, UI outstanding** features, F-026 (seller fulfilment) and F-027 (deliver,
  inspect, release), both in web-app-ui, so run one at a time or pair one with a console or backend feature.
  F-044 and F-045 wait on their dependencies. Also the full `KOMTRU_INFRA_TESTS=1` run on `main`.

## 2026-11-11 00:23 WAT — run summary

- skipped: budget (5h 83%, week 12%). est≈29 (median of recent feature costs), so 5h + est > 90.
- Capacity: 0. No in-flight worktrees or branches to resume.
- Next: unchanged. F-026 or F-027 (Backend done, UI outstanding, both web-app-ui, one at a time), and the full
  `KOMTRU_INFRA_TESTS=1` run on `main`. The 5-hour window resets at 02:29 WAT.

## 2026-11-11 07:36 WAT — skipped: locked (lock from 2026-11-11T04:31:58Z; 5h 47%, week 18%; F-026 worktree committed at 07:02 WAT)

## 2026-11-11 08:20 WAT — run summary

- Usage at start: 5h 1%, week 12%. At end: 5h 85%, week 23%.
- Capacity: 2 (est 34, est_week 5: 1 + 2×34 ≤ 90; 12 + 2×5 ≤ 85). Every Ready MVP feature's UI is in web-app-ui, so the
  second slot ran the **backend layer only** of F-037 (ledger module, the only migration in flight) beside F-026 (web-app-ui).
  Features: F-026 (merged, Done), F-037 (backend layer saved at implement, plan steps 1–4 of ~8).
- F-026 (sonnet): ship screen (Seller-3/X2 self-arranged with waybill, receipt photo, driver phone and plate,
  client-validated to the backend rules), X1 dispatch lock worded by status, Report delivery on the shipped state, and AC8
  Active Orders on `/orders`. Seller-2/W1–W3/BR1/SD1 were already built by F-017. MI3 and the Park/courier branches are left
  out for MVP. Review: 2 must-fix and 7 should-fix items, all fixed. On `main`: package build, lint, typecheck and test for
  web-app-ui (531) and api-client (254) are green, and the format check is clean. Visual check is in `docs/ui-review/T-123/`
  (its shots predate the fixes). The fixer noted `MyTrades.tsx` has the same failed-later-page bug as ActiveOrders had.
- F-037 (opus, money): migration `0048_ledger_payouts`, payout posting rules, the sweep calendar, a frozen payout fee, and
  Paystack transfer verification behind a port. 505 ledger and db tests are green and `migration:safety` is clean. It was
  stopped at 85% of the 5-hour window, before review. The branch is clean, with nothing unverified.
- Feature costs, together: 5h-cost=84 week-cost=11. F-037 (opus, implement only) cost the most.
- Next: resume F-037 on `f-037-payouts` at plan step 5 (services with concurrency tests), then review, fix and merge. Its
  migration 0048 is in flight, so pair it only with a migration-free feature, for example F-027 (deliver, inspect, release;
  Backend done, UI outstanding, web-app-ui). Still owed: the full `KOMTRU_INFRA_TESTS=1` run on `main`.

## 2026-11-11 09:13 WAT — skipped: budget (5h 90%, week 24%)

- Capacity: 0. 5h used (90%) + est≈29 > 90. Window resets at 10:30 WAT. In-flight F-037 (`f-037-payouts`, plan step 5)
  is not a cheap tail, so nothing was resumed.
- Next: resume F-037 at plan step 5, then review, fix and merge; pair only with a migration-free feature such as F-027.

## 2026-11-11 12:13 WAT — run summary

- Usage at start: 5h 1%, week 24%. At end: 5h 55%, week 31%.
- Capacity: 2 (est 34, est_week 5: 1 + 2×34 ≤ 90; 24 + 5 ≤ 85). In-flight F-037 (backend, migration 0048) ran in parallel
  with F-027 (web-app-ui, no migration), with test prefixes `komtru_f037` and `komtru_f027`. Features: F-027 (merged, Done),
  F-037 (backend layer merged, T-124 UI outstanding).
- F-027 (sonnet): UI only, over T-065/T-074. Customer-4/Z4 Inspect & Confirm at `/trade/[id]/inspect`, Z5 release behind an
  acknowledgement, BEI1/BEI2 inspection extension, AB1 self-arranged logistics and confirm delivery, DE1–DE3 delivery extension,
  and new api-client hooks. AB2/Park and MI4/multi-item are deferred. The visual check is in `docs/ui-review/T-118/`. Also fixed:
  bottom sheets sat under the tab bar (`OverTabBar`). Review: 1 must-fix and 7 should-fix items, all fixed. The fixes added a
  double-submit guard and a ticking clock. T-118 is "Done for MVP scope".
- F-037 backend (opus, money): plan steps 5–9. Services under a per-user lock (a concurrency test proves no double-spend),
  dispatch and account-verify jobs, `transfer.*` webhooks with the outcome decided only by provider verify, auto-immediate
  payout on release, the 09:00 Lagos sweep, the 5-minute safety sweep, the `/me/payout-accounts` and `/me/payouts` routes,
  api-client and shared-types. Review: 3 must-fix and 9 should-fix items, all fixed. The main one: holds and the account
  state were not re-checked before a resend. Also fixed: a platform bug in which the idempotency gate failed (500) on bigint
  bodies; it is now hashed safely. Migration 0048 gained two indexes before merge.
- Verification: the F-027 branch and `main` ran package build, then lint, typecheck and test for web-app-ui (579) and
  api-client (262), plus the format check. The F-037 fixer ran the full backend-api suite with `KOMTRU_INFRA_TESTS=1` (5408).
  On `main` after both merges, the manager ran the whole-repo `turbo run lint typecheck test --force` (37/37 tasks, default
  suite), the format check, and `migration:safety` (49 migrations, 0 errors).
- Feature costs, together: 5h-cost=54 week-cost=7, about 27 and 3–4 each. F-037 (opus) cost most.
- Next: F-037's T-124 Seller Payouts UI (web-app-ui; Backend done, UI outstanding). Pair it with a non-web-app-ui feature, or
  with F-044/F-045 only if those touch different areas. F-044 and F-045 are also Backend done, UI outstanding. The full
  `KOMTRU_INFRA_TESTS=1` run on `main` is still owed by the manager.

## 2026-11-11 15:47 WAT — run summary

- Usage at start: 5h 58%, week 32%. At end: 5h 88%, week 36%.
- Capacity: 1 (est 29, est_week 4: 58 + 29 ≤ 90, 58 + 2×29 > 90). Features: F-037 UI layer (T-124), saved at fix, before merge.
- F-037 UI (opus, money): Seller-6, AB5, AB6, WF1, PR1 under `/account/payouts/...` in web-app-ui, plus api-client payout hooks.
  No backend change, no migration. Visual check in `docs/ui-review/T-124/` (deviations accepted). Review: 2 must-fix
  (withdraw dropped its idempotency key after an ambiguous 408/409/5xx failure, risking a double payout; a failed
  background refetch unmounted the form and lost the key) and 8 should-fix items, all fixed. Fixer verification: package
  build, lint, typecheck and test for web-app-ui (618) and api-client (276), format check, all green.
- Stopped at 88% of the 5-hour window before the merge phase. The branch is clean, 17 commits, nothing unverified.
- Feature costs: F-037 UI (implement+review+fix) 5h-cost=30 week-cost=4.
- Next: merge F-037 UI: package build, `turbo run lint typecheck test --force` in the worktree and on `main`, format check,
  then merge and set the statuses. Whether F-037 is `Done` depends on the viewer-seam owner question (no link to the
  screens yet). F-044 and F-045 remain Backend done, UI outstanding. The full `KOMTRU_INFRA_TESTS=1` run on `main` is still owed.

## 2026-11-11 18:13 WAT — run summary

- Usage at start: 5h 1%, week 36%. At end: 5h 14%, week 38%.
- Capacity: 2 (est 34, est_week 5: 1 + 2×34 ≤ 90; 36 + 5 ≤ 85). In-flight F-037 UI used the first slot. Features: F-037 UI
  (merged; feature stays Backend done, UI outstanding on the viewer-seam question), F-013 (merged, Done).
- F-037 UI (T-124): the manager ran the merge checks. In the worktree: package build, then lint, typecheck and test for
  web-app-ui (618) and api-client (276), and the format check. After merging, on `main`: whole-repo
  `turbo run lint typecheck test --force` (37/37) and the format check. T-124 is Done. The feature is not Done, because no
  user can reach `/account/payouts` until `resolveViewer` reports `hasSold`.
- F-013 (sonnet): OB1–OB5 under `/welcome/*`, reached only by a new sign-up (E3 verify passes `next=/welcome`). The walkthrough
  is remembered per device and redirects once done. OB4 asks for browser push permission. It would register through the new
  api-client `registerDevice` (`POST /me/devices`), but there is no web token source yet (owner question). OB5 has the
  Trade Code entry. No backend change, no migration. Visual check `docs/ui-review/T-112/` passed (≤2% differing pixels).
  Review: no must-fix, 9 should-fix items. 8 were fixed (focus handling, gate flash, deep-link OB5, first-name PII cleanup,
  Safari permission, Sentry capture, fingerprint fallback, tests). `next/link` was declined, per the T-110 plain-anchor
  pattern. On the branch, web-app-ui (666) and api-client (278) are green. On `main`, `turbo` is 37/37 and the format check is clean.
- Feature costs: F-037 UI merge 5h-cost=2 week-cost=0; F-013 (implement+review+fix) 5h-cost=11 week-cost=2.
- Next: Ready MVP features in journey order: F-018 (create a trade, buyer starts), then F-023, F-028, F-029 and F-030.
  F-044 and F-045 wait on F-046 (and F-030), so they are not Ready yet. F-037 waits on the viewer seam (owner). The full
  `KOMTRU_INFRA_TESTS=1` run on `main` is still owed.

## 2026-11-11 21:47 WAT — run summary

- Usage at start: 5h 15%, week 38%. At end: 5h 85%, week 47%.
- Capacity: 2 (est 27, est_week 4: 15 + 2×27 ≤ 90; 38 + 4 ≤ 85). No in-flight work. F-018 (web-app-ui, no migration) ran in
  parallel with the F-030 backend layer (backend-api, migration 0049), with test prefixes `komtru_f018` and `komtru_f030`.
  Features: F-018 (merged, Done), F-030 (backend layer saved at review, before fix).
- F-018 (sonnet): CT-B1–CT-B10, CT-B2P, CT-B8P in `src/trade/create/`, with `/trade/new` in Buy mode and `/trade/[id]/complete`.
  No backend or api-client change. Review: 4 must-fix (Park submit dead end, double-submit, funding not blocked for a spec still
  holding "Seller to confirm", axe gaps) and 8 should-fix items. All were fixed except `next/link`, declined per T-110.
  E2E is waived because there is no harness. The visual check in `docs/ui-review/T-192/` reports 3.3–6.6% differing pixels
  with the shell masked. The difference is copy and data, not layout, and the deviation was accepted. Checks in the worktree
  and again on `main`: package build, then lint, typecheck and test for web-app-ui (735) and api-client (278), plus the format check.
- F-030 backend (opus, money): T-075 refunds and T-066 post-funding cancellation, migration `0049_refunds_cancellations`,
  routes, and the shared-types and api-client hooks. Implementer: backend 5478 tests (infra on), api-client 287, shared-types 199, migration
  safety clean. Review: 1 must-fix (an approved cancellation can be stranded by a hold, with nothing to re-drive it) and 7
  should-fix items, recorded in the T-066, T-075 and F-030 status lines. Stopped at 85% of the 5-hour window, because an opus
  fix phase would have crossed 88%. The branch is clean and committed (10 commits). Nothing is merged.
- Feature costs, together: 5h-cost=70 week-cost=9. F-018 (implement+review+fix+merge) was about 25, and F-030 (implement+review) about 45.
- Next: resume F-030. Resume its implementer as fixer, or start a fresh opus fixer with the review items from the status lines.
  Then merge (full backend suite with `KOMTRU_INFRA_TESTS=1`, migration safety), then the T-119 UI layer. After that, F-023,
  F-028 and F-029 in journey order. F-037, F-044 and F-045 remain Backend done, UI outstanding. The full
  `KOMTRU_INFRA_TESTS=1` run on `main` is still owed.

## 2026-11-12 09:14 WAT — skipped: locked (lock from 2026-11-12T05:57:00Z; 5h 51%, week 68%; active run merged F-019 at 09:03 WAT and committed at 09:10 WAT)

## 2026-11-12 09:30 WAT — run summary

- Usage at start: 5h 1%, week 61%. At end: 5h 53%, week 68%.
- Found a stale lock from 01:24 WAT. That run never logged. It started the F-019 UI and the F-030 fix phase, spent about
  14% of the week (47→61), and died without closing. Its work was on the branches, so nothing was lost.
- Capacity: 2 (est 25, est_week 4: 1 + 2×25 ≤ 90; 61 + 4 ≤ 85). Both slots went to the in-flight work. F-019 is web-app-ui with
  no migration. F-030 is backend-api with migration 0049. Test prefixes were `komtru_f019` and `komtru_f030`.
  Features: F-019 (merged, Done), F-030 backend layer (merged; the feature is Backend done, UI outstanding).
- F-019 (sonnet): CT-S1–CT-S5, CT-S2F, CT-S6, CT-S7. A fresh implementer finished the visual check (`docs/ui-review/T-193/`; CT-S5
  is 19.9% off because of a 60px offset with no stage rail, and the rest is 9.8–11.7%, mostly shell and content) and the verification.
  Review: 2 must-fix (a stale category spec sent after a Back and title edit; the proof uploader losing its attachments on Back
  while their ids were still sent) and 6 should-fix items. All were fixed. web-app-ui 778, api-client 278. E2E is waived (no harness).
- F-030 backend (opus fixer): the must-fix is fixed. The re-drive sweep now re-decides an approved refund that a hold stranded.
  Should-fix items 2, 3, 4, 5, 7 and 8 are fixed. Item 6, failed-refund recovery, is deferred to T-076. The fixer also fixed an
  api-client typecheck that was already broken on the branch.
- Merge checks:
  - In each worktree: package build, then lint, typecheck and test, the format check, and migration safety (0 errors).
  - On `main`: the whole-repo `turbo run lint typecheck test --force` with `KOMTRU_INFRA_TESTS=1` gave 36/37. Only the
    backend-api test task failed, under load. Re-run alone it passed (313 files, 5498 tests), so the full infra run on `main`
    that was owed is now done. migration:safety on `main` has the expected "baseline is this commit" warning.
- Feature costs, together: 5h-cost=52 week-cost=7. That covers F-019 (finish, review, fix, merge) and F-030 (fix, merge).
- Next: the F-030 UI layer (T-119), then F-023, F-028 and F-029 in journey order. F-037, F-044 and F-045 remain Backend done,
  UI outstanding. Watch backend-api for flaky tests under turbo load.

## 2026-11-13 13:00 WAT — run summary

- Usage at start: 5h 4%, week 69%. At end: 5h 25%, week 71%.
- Capacity: 1 (est about 30, est_week 4). The only other candidate, the F-030 UI (T-119), is also web-app-ui, so the two could not run in parallel.
- Features: F-037 (merged, Done).
- F-037 viewer seam (opus, because the feature absorbs T-073 and the work is session security). This closes the owner's 2026-11-12 yes.
  - Backend: new route `GET /me/viewer` in trades, returning `{hasSold, certifiedMerchant}`, CONSUMER only, at 60 per minute per user and IP.
  - Session hint: app-kit's auth route seals those facts into the HMAC-signed `komtru_session` hint on sign-in and refresh, through a `describeSession` option.
  - `resolveViewer` opens the hint, falling back to anonymous.
  - No migration. Test prefix `komtru_f037`, Redis db 3.
- Review:
  - 1 must-fix: the viewer read did not forward `x-forwarded-for`, so the IP rate limit keyed every user on the web server.
  - 5 should-fix items:
    - keep the facts on a failed refresh read, for the same subject only (a digest of `sub`);
    - skip the read for non-CONSUMER sessions;
    - add tests for the STAFF 403 and the 429;
    - fix a timeout listener leak;
    - make `seal` strict.
  - All were fixed.
- Merge checks:
  - In the worktree: package build, then lint and typecheck for the five touched packages, and the format check. The fixer's full suites passed: backend-api 5513, web-app-ui 790, app-kit 280, api-client 290, shared-types 203.
  - On `main`: package build, then turbo lint, typecheck and test with infra on, across the touched packages and the apps that consume app-kit, gave 27/28. Only backend-api test failed: 1 failure, the `relay.int.test.ts` "waits for an older uncommitted transaction" timing test, at 4.6s under load. It passed 3 out of 3 times alone. The merge touched no platform/events code.
  - format:check is clean.
- Feature costs: F-037 seam (implement+review+fix+merge) 5h-cost=21 week-cost=2.
- Next: the F-030 UI layer (T-119), then F-023, F-028 and F-029 in journey order. F-030, F-044 and F-045 remain Backend done, UI outstanding. The relay test is flaky under turbo load and is a candidate for F-005.
- **Concurrent work:** during this run, while this run's lock was held, another session merged F-028 (`5cf0239`, `946904d`) into `main`. It also left worktrees `f-023-workspace-terms` and `f-029-proof-media` in flight. F-028 was already on `main` when this run did its post-merge checks, so those checks covered it. The next run should resume F-023 and F-029 as in-flight work before starting F-030 UI. It should also find out why that session did not honour `.claude/manager.lock`.

## 2026-11-13 15:45 WAT — run summary (second session, alongside the manager's F-037 run)

- Run by a second Claude session at the owner's request ("take up a few more tickets in sub agents"), concurrently with the scheduled manager run that held the lock from 12:04Z. **The lock was not taken and `docs/manager/` was not written to while that run was live.** Features were chosen to miss F-037 and F-030 entirely.
- Capacity: 3, on a separate account's budget, so the Pro gates in MANAGER.md step 0 did not bind. Features: F-023 (merged, Done), F-028 (merged, UI complete except CWT-S13), F-029 (merged, Done).
- All three are frontend-only MVP features whose backends were already merged, none adds a migration, and each ran in its own worktree with its own `KOMTRU_TEST_DB_PREFIX`.
- **F-028 (T-195, sonnet):** CWT-S08–S13 in `src/trade/delivery/`. Review: 1 must-fix, 6 should-fix, all fixed. The must-fix was a **regression in shipped F-026 work** — repointing `shipHref` to the new `/dispatch` stranded the seller's "Report delivery", which lived only on the old `/ship` page. Merged first, at 5cf0239.
- **F-023 (T-194, sonnet; reviewed on opus because it modified the live escrow payment flow):** 12 screens, with TW-03 and CWT-S03–S07 redrawn in place in F-024's `FundTrade.tsx` plus a new CWT-S04 review step. Review: **2 money must-fixes**, 9 should-fix, all fixed. (1) CWT-S07 had promoted "Try payment again" — a server-side abandon-and-remint — to the primary action on the screen a delayed bank transfer lands on, inviting a double payment. (2) CWT-S06 asserted held funds and a pending payout unconditionally, on a screen reachable for SETTLED and RESOLVED_REFUNDED. The transaction machinery was correctly left alone and no payment assertion was weakened.
- **F-029 (T-197, sonnet):** PM-1–PM-8 in `src/trade/proof/`. Review: 3 must-fix, 9 should-fix, all fixed. **It collided with F-028 on `/trade/[id]/evidence`:** both added the route, and resolving in F-029's favour would have compiled on each branch and broken `main`, because F-028's `delivery/Evidence.tsx` imports a `ProofTile` that F-029 deleted. Resolved by keeping F-028's page as the host for F-029's PM-6 layout.
- **Machine load is the real cause of the "backend-api is flaky under turbo load" note.** With two sessions testing at once the whole-repo run on `main` failed twice with _different_ suites down (backend-api, then app-kit), both on 5-second timeouts, at load average 82 with 62 node processes. Each suite passed alone and `--concurrency=2` gave 37/37. Check `uptime` before debugging a whole-repo failure.
- Verification on `main` after each merge: packages build, then `turbo run lint typecheck test --force --concurrency=2` **37/37**, and `pnpm format:check` clean. Infra tests were not run (the other session was using the shared Postgres and Redis).
- Feature costs: not comparable to the manager's 5h/week percentages — a different account and plan. Subagent token spend was roughly 1.7M across three implementers, three reviewers and three fix passes.
- Next: F-031 (T-198) is the newly Ready MVP feature. F-030's UI (T-119) is still outstanding and was deliberately left to the manager. F-037, F-044 and F-045 remain the Backend-done-UI-outstanding group; F-044 and F-045 still wait on F-046.
