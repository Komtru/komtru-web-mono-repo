# Epic 07 — Trades and orders (M7, M9)

State machine: design §6 (decision C1). Trades never touch money; they request it from the ledger through events.

---

### T-060 — Trade schema, state machine and audit

- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-060-trades.md`
- **Deferred:**
  - `canActAsBuyer` lives in `trades/domain/eligibility.ts` against a `TradePrincipal` because identity has no service layer yet. Design §6.3 makes it one identity function: T-031 must lift it into identity's barrel and trades must delegate rather than keep a second copy.
  - `TradeFeeSnapshot` in `trades/domain/feeSnapshot.ts` is a structural copy of `FeeSnapshot` from `@komtru/shared-types`, because T-047 landed on `main` after this branch was cut. It must become a re-export of that type, and `feeSnapshotColumns` must take `snapshotFees(...)`'s result directly, as soon as the two are in one tree; the shape test in `fee-snapshot.test.ts` is what fails if they drift. The trade's money columns use the calculator's vocabulary (`seller_proceeds_minor`, `platform_revenue_minor`) so the ledger reads one set of names.
  - Delivery-signal trust weighting — which source moves a trade to `INSPECTION` rather than `UNCONFIRMED_DELIVERY`, and M7 §6's partner-history exception — is T-064. T-060 owns the table and the two reachable targets.
  - Design §6.2 draws no `SHIPPED → CANCELLED_REFUNDED` edge, so DE3's overdue-delivery refund after dispatch has to go through `DISPUTED`. T-064/T-066 should confirm that with the owner, or the edge needs adding to §6.2.
  - **Deliberate widening of §6.2:** `CANCEL` is drawn from `DRAFT`, `PENDING_COUNTERPARTY` and `UNDER_PROPOSAL_REVIEW` as well as the two states §6.2 draws it from, following M7 D3 and HTML CT1 — a draft that cannot be abandoned and an invitation that cannot be withdrawn would both be bugs. Flagged for the owner rather than left to be discovered.
  - `fulfilment_substate` (`AWAITING_SHIPMENT`, m2 §7a's dormant value) is not modelled; T-064 adds it with the ship step.
  - `TRADE_STATUSES`, `TRADE_ACTIONS` and the trade event payload schemas stay in the backend domain; T-061 should lift them into `@komtru/shared-types` when the HTTP contract needs them on the client.
  - Trade-code collisions are handled by `withTradeCode(tx, insert)`, which retries a `trades_trade_code_unique` violation in a savepoint; T-061's creation path must go through it rather than inserting a bare `generateTradeCode()`.
  - Q12 (relaxing the seller's level-2 gate for casual sellers) is still open; the gate is implemented as design §6.3 states it.

- **Touches:** `src/modules/trades/{domain,infrastructure}/**`, migration `trade_*`
- **Depends on:** T-024, T-025, T-030
- **Acceptance criteria:**
  - Tables: `trades`, `trade_terms_versions` (each proposal or counter-proposal is a new immutable version; the accepted version is pinned), `trade_state_changes` (append-only), `trade_activity` (append-only lifecycle log, resolves m2 §13.1), `delivery_signals` (source enum `BUYER_CONFIRMATION`, `SELLER_SELF_REPORT`, `PARTNER_PORTAL`, `PARK_CUSTODY`, `COURIER_API`), `escrow_action_requests`, `trade_holds`, `trade_deadlines`.
  - Trade codes in the HTML format (`KMT-88213`), unique, non-sequential.
  - Pure `canTransition(action, from)` covering every transition in design §6.2; unit tests for every valid transition and at least one invalid jump per state; services return `409 INVALID_TRANSITION`.
  - `trades.initiator_role` (`BUYER` or `SELLER`) recorded on every trade.
  - Eligibility gates per design §6.3: no `SELLER` capability gate; `canActAsBuyer` wherever a user would become the buyer (`403 MERCHANT_CANNOT_BUY`); buyer level 1 at funding; seller level 2 before funding. Each fails with a specific error and publishes `trade.eligibility_blocked`. Tests cover a merchant trying each buyer path and a merchant's in-flight buyer trade completing after certification.
  - `inspection_window_hours` and `delivery_grace_hours` are integers snapshotted from Trade Standards (resolves m2 §13.3).
  - `trade_terms_versions` carry a delivery address snapshot and a ships-from address snapshot (street, landmark, recipient, `state_id`, `city_id`), both required (design §7.8).

### T-061 — Proposal flow

- **Touches:** `trades/services/{proposal,trade}.service.ts`, `trades/http/**`
- **Depends on:** T-060, T-035, T-049, T-040, T-047, T-046, T-042
- **Acceptance criteria:**
  - The initiator chooses `initiatorRole` on every trade; a certified merchant is forced to `SELLER`. Item spec validated against the category's Trade Standards (G1, Z2); live contract preview data (Z3).
  - Naming a certified merchant as the buyer is rejected before send, and the counterparty's `canBuy` is checked again at acceptance and invitation claim.
  - Send: counterparty by `@username`, email or phone via party lookup; non-users get a party invitation and the trade sits in `PENDING_COUNTERPARTY` until claimed or expired after 14 days.
  - Seller proof media is mandatory before a trade can reach `PENDING_PAYMENT`: attached at send time for a seller-initiated proposal, or at acceptance when the seller accepts a buyer's proposal (W1, where Accept stays disabled until media is attached); counter-proposal creates a new terms version and flips the turn (W2, BR1); decline with reason (SD1); cancel before funding (CT1).
  - "Do not ship yet" state after acceptance (W3) is `PENDING_PAYMENT`. Acceptance snapshots the fee schedule version and computed fees onto the trade (T-047), so the buyer sees the exact total before funding.
  - Every action is idempotent, writes state changes and activity, and publishes events.
  - The buyer picks a saved address as the delivery address and the seller picks one as the ships-from address; both are snapshotted into the terms. Sending, accepting or claiming a trade without a usable address returns `422 ADDRESS_REQUIRED`, and the client sends the user to add one. Changing either address is a term change.
- **Status:** Done (2026-11-07). Plan: `docs/superpowers/plans/2026-11-07-t-061-proposal-flow.md`. Review: 10 items fixed (2 must-fix).

### T-062 — Proposal risk hold and TrustOps review

- **Touches:** `trades/services/proposalReview.service.ts`, risk rule hook
- **Depends on:** T-061, T-101, T-107
- **Acceptance criteria:**
  - On send, risk rules may hold a proposal (`UNDER_PROPOSAL_REVIEW`); the proposer sees the held state (G3) and it appears in their trades as pending verification (Q1).
  - Holds register as `TRADE_PROPOSAL` cases with an advisory; staff can clear (seller then sees it, R1) or reject, with reason and policy cite.

### T-063 — Orders and multi-item trades (M9)

- **Touches:** `src/modules/orders/**`, migration `orders_*`
- **Depends on:** T-061, T-056
- **Acceptance criteria:**
  - One order per trade; `order_items` with immutable listing snapshot and unit price; derived order status (view), never stored independently.
  - Cart checkout and buying from a listing are blocked for certified merchants (`canActAsBuyer`). Cart review (MI1) bundles several listings from one seller into one trade; agreement shows repeated item cards (MI2); start trade from a listing (I3).
  - Per-item ship confirmation (MI3) and per-item inspection results (MI4) recorded on items; partial acceptance feeds the dispute flow.

### T-064 — Fulfilment: ship step, delivery signals, deadlines

- **Touches:** `trades/services/{fulfilment,deliverySignal,deadline}.service.ts`, `trades/jobs/**`
- **Depends on:** T-061, T-072
- **Acceptance criteria:**
  - Dispatch guard: shipping endpoints return 409 until `FUNDED` (X1).
  - Ship step offers every `ENABLED` logistics company with Park pinned first, plus the permanent "arrange my own shipping" option (m2 §10). Self-arranged ship requires waybill number, receipt photo, driver phone and plate (X2) and moves the trade to `SHIPPED`. Company and Park branches are completed in T-087 and T-093.
  - A single delivery-signal consumer (design §7.5 payload) applies M7 §6 trust weighting, including the partner-history exception, and moves the trade to `INSPECTION` or `UNCONFIRMED_DELIVERY`.
  - Delivery deadline per trade; seller extension request and buyer response (DE1, DE2); overdue with no extension triggers an automatic refund request (DE3, DE4).
  - All deadline jobs are idempotent and re-check state and holds.
  - Ship-step options are computed server-side: Park is offered only when both trade cities are Park-serviceable (design §7.8), with the reason returned when it is not, so the client never decides availability.
- **Status:** Done (2026-11-09). Plan: `docs/superpowers/plans/2026-11-09-t-064-fulfilment.md`. Review: 6 items fixed (no must-fix; no acceptance criterion was found unmet). Migration `0045_trade_fulfilment` adds `trade.self_arranged_shipments` (append-only, `ON DELETE restrict`, unique on `receipt_file_id`) and `trade.delivery_extension_requests`, plus the nullable `trades.fulfilment_substate` column T-060 deferred here. `assertDispatchOpen` guards every shipping endpoint: 409 before `FUNDED`, 409 from `SHIPPED` onward, and 409 once the delivery deadline has elapsed, so a seller cannot ship into a refund already in flight. `GET /trades/:id/ship-options` is seller-only and computes Park availability **server-side** from both trade cities, returning the reason when unavailable. The self-arranged branch writes evidence and transitions `BEGIN_CUSTODY` in one transaction under `FOR UPDATE`. `applyDeliverySignal` takes `unknown` and `safeParse`s it, so a malformed payload returns `REJECTED / INVALID_PAYLOAD` instead of retrying forever; a human signal is deduplicated **only when it could not move the trade**, which was the review's sharpest find — a self-report arriving before `SHIPPED` was otherwise stored `RECORD_ONLY` and then shadowed the genuine one as a `DUPLICATE`, so the trade never moved. The sweep job (`trades.delivery-deadlines`, every 5 minutes) locks the trade `FOR UPDATE SKIP LOCKED`, re-reads status and holds, and claims the row with a guarded `UPDATE ... WHERE status='PENDING' RETURNING` in the same transaction that publishes. **Default applied, not a rule invented (owner to confirm):** a pending extension request stops blocking once the original `dueAt` passes — it is marked `LAPSED` with an activity row and the refund request proceeds. Without this a seller could request an extension just before the deadline and a silent buyer would strand the escrow permanently, which met DE4's letter and defeated its purpose. **Seams:** the company branch is T-087 (`enabledCompanies` returns none) and Park is T-093 (`serviceableCityIds` returns none); both must subscribe their delivery event to `applyDeliverySignal`. An overdue deadline publishes `trades.refund.requested` with **no amount** — the amount is a money rule and T-075 derives it from the fee snapshot. **Open for the owner:** whether a `SHIPPED` trade past its deadline should refund at all (design §6.2 has no `SHIPPED → CANCELLED_REFUNDED` edge); whether a `PARK_EXCEPTION` hold should block the buyer's confirmation, since delivery signals currently apply while a hold is active and T-065 will rely on the same rule.

### T-065 — Inspection and completion

- **Touches:** `trades/services/inspection.service.ts`, `trades/jobs/**`
- **Depends on:** T-064
- **Acceptance criteria:**
  - Inspection window from the snapshot; buyer may request more time once (BEI1), seller sees and responds (BEI2).
  - Compare seller's proof with delivery evidence (Z4 data); confirm and release with explicit acknowledgement (Z5) moves to `COMPLETED`; the window elapsing auto-completes (AR1) unless a hold or dispute exists.
  - Unconfirmed-delivery grace auto-converts per M7 §6.
  - `trade.completed` triggers the ledger release; `payment.escrow_released` moves the trade to `SETTLED`.
- **Status:** Done (2026-11-09). Plan: `docs/superpowers/plans/2026-11-09-t-065-inspection.md`. Review: 4 items fixed, no must-fix. Migration `0046_trade_inspection` adds `trade.inspection_extension_requests` (unique on `deadline_id`, so BEI1's "once" is a database constraint rather than service logic) and the append-only `trade.inspection_acknowledgements`, which is Z5's evidence. Two sweeps, `trades.inspection-deadlines` and `trades.grace-deadlines`, copy T-064's concurrency shape: lock the trade `FOR UPDATE SKIP LOCKED`, lock the deadline, re-read status, holds and the dispute seam **under those locks**, then claim with a guarded `UPDATE ... WHERE status='PENDING' RETURNING` and publish in the same transaction. A hold or open dispute returns `WAIT` and leaves the row `PENDING`. **The cross-module contract was the risk here:** importing the ledger would be a cycle, so `domain/ledgerEvents.ts` declares `ledger.payment.escrow_released` consumer-side; review confirmed it matches T-074's producer, and `test/modules/trades/domain/ledger-events.contract.test.ts` now imports the ledger's real event definition and fails on any rename, removal or type change — without it, drift would leave a trade at `COMPLETED` with the money unpaid and nothing erroring. Z4's seller proof, delivery signals and waybill are disclosed only from `SHIPPED` onward, gated by an explicit status set rather than enum order (`CANCELLED_REFUNDED` sorts after `SHIPPED` and would have wrongly passed). **Defaults applied, owner to confirm:** a hold refuses Z5 completion with 409 `HOLD_ACTIVE` (though delivery confirmation stays unblocked — T-064's open question); after a hold lifts the window has already elapsed, so the next sweep completes at once and the buyer gets no fresh time (the literal reading of AR1); a seller silent on a BEI1 request lets it lapse at the original deadline, because the alternative gives the buyer an unbounded lever over the seller's money. **Seam:** `InspectionDeps.disputes.hasOpenDispute` is T-080's; the production adapter answers false and the `DISPUTED` status guard covers the interim.

### T-066 — Post-funding cancellation and can't-fulfil refunds

- **Touches:** `trades/services/cancellation.service.ts`
- **Status (2026-11-11): in progress** — backend layer implemented on branch `f-030-cancel-refund` (10 commits, migration 0049, plan docs/superpowers/plans/2026-11-11-f-030-refunds-backend.md) and reviewed; next: fix (opus), then merge; T-119 UI after. Open review items: must-fix 1 approved cancellation stranded by a hold (no re-drive/sweep); should-fix 2 dispatch re-check holds, 3 foreign provider refund attach, 4 /me/refunds cursor microseconds, 5 sweep multiplies poll chains, 6 failed-refund recovery unwired (T-076?), 7 test gaps, 8 api-client note trim.
- **Depends on:** T-064, T-075
- **Acceptance criteria:**
  - Buyer requests cancellation before shipment (CR1); seller approves or declines (CR2); approval requests a full refund (CR3) and moves to `CANCELLED_REFUNDED`.
  - Seller can't fulfil (SC1) refunds automatically (SC2).
  - Pre-funding cancellation stays a plain status change (M7 D3).
- **Status:** Backend done (2026-11-11, F-030 backend layer, not yet reviewed or merged). Plan: `docs/superpowers/plans/2026-11-11-f-030-refunds-backend.md`. `trade.cancellation_requests` (migration 0049); `cancellation.service.ts` with `GET /trades/:id/cancellation`, `POST /trades/:id/cancellation-request`, `…/:requestId/approve|decline` and `POST /trades/:id/cannot-fulfil`. Approval and SC1 publish `trades.refund.requested` and close dispatch; `ledger.payment.escrow_refunded` moves the trade `FUNDED → CANCELLED_REFUNDED` with its cancellation reason. CR2's 12-hour auto-approval is not built (owner question). The T-119 UI is outstanding. **Review fix (2026-11-12, not yet merged):** must-fix 1, an approved cancellation (or DE3 refund) whose request the ledger refused because a hold was placed before the decision no longer strands the trade: `refundsAwaitingDecision` lists FUNDED, unheld trades whose refund was requested over 10 minutes ago, and the ledger's refund sweep decides each again (see T-075). Added route and body tests and an approve-versus-cancel race test.

### T-067 — IMEI verification

- **Touches:** `src/modules/devices/**`
- **Depends on:** T-061, T-028
- **Acceptance criteria:**
  - Lookup adapter interface with a deterministic fake; real provider disabled until credentials exist (design §12 Q7).
  - Lookup runs as a job when an electronics item spec includes a serial or IMEI; results (clean, flagged stolen or blacklisted, unknown) attach to the terms version (AC4) and a flagged device blocks sending with an explanation (IF1) and a risk signal.

### T-068 — Trade realtime, notifications and deep links

- **Touches:** `trades/infrastructure/{realtime,notifications}.ts`
- **Depends on:** T-065, T-045, T-027
- **Acceptance criteria:**
  - Trade room authorisation (parties only, plus staff with `trade.view_all`); every state change pushes a trade update.
  - Templates and mappings for every trade event the HTML surfaces (proposal received, accepted, funded, shipped, arrived at hub, pickup PIN ready, delivered, inspection reminder, auto-release, cancellation and refund outcomes).
  - Deep links to `app.komtru.com/trades/:code`.
- **Status:** Done (2026-11-09). Plan: `docs/superpowers/plans/2026-11-09-f-022-realtime.md`. Review: 8 items fixed, no must-fix and **no authorisation hole** — the reviewer traced every allow path. Migration `0047_trade_inspection_reminder`. Built as the backend half of feature **F-022**, which stays open until the workspace UI ships. Rooms are `trade:<tradeCode>` over T-027's gateway: parties of record on a CONSUMER session, or STAFF holding `trade.view_all`, everything else an identical `FORBIDDEN` so it is not an existence oracle. One subscriber on `trades.trade.state_changed` covers every edge, and pushes emit after commit. **The push is a refetch signal, not data** — it carries status, kind and timing and nothing else, which is what makes the known T-027 gap survivable (see below). 22 notification templates, derived from the plans so copy without a plan cannot exist, IN_APP + PUSH with EMAIL on money outcomes. The wire contract lives in `@komtru/shared-types` (`tradeUpdateSchema`, strict) with a contract test that parses what every push actually emits across every state-machine edge — proven by injecting a `reason` field and watching it fail. **Beyond T-068's text**, this also added `GET /trades` (cursor-paginated, server-computed `attention`, counterparty display) and `GET /trades/by-code/:code`, because without them an invited party had no route into a trade at all and the F-017 UI was falling back to a device-local list. The by-code lookup answers byte-identically across six not-for-you cases and is one query in every case, so timing matches too. The cursor carries the database's microsecond text, not a JS Date, and a malformed or filter-mismatched cursor returns 422 rather than silently restarting at page 1 — the bug T-107 and T-052 both shipped. An inspection reminder sweep was invented here because no such event existed; accepting an extension clears `reminder_sent_at`, so a buyer still gets warned before the new close rather than losing the window to an auto-complete. **Also fixed:** four test fixtures built `due_at` and `original_due_at` from two separate `Date.now()` calls and failed roughly 1 run in 3 against `trade_deadlines_never_shortened` — a genuine race that had been written off as the shared-Postgres flake. **Criterion 2 is partly deferred:** Park hub arrival and the pickup PIN are T-093's (a credential does not belong in a generic feed), refund-paid is T-075's and dispute notices are T-080's. **T-027 follow-up:** the revalidation sweep (`socket/services/revalidate.ts`) re-checks the credential but never re-authorises rooms already joined, so a staff member who loses `trade.view_all` stays in the room until they disconnect; it should re-run `authorizers.authorize` per joined room. **T-062 constraint:** pushes and notifications for `UNDER_PROPOSAL_REVIEW` edges must not reveal a held proposal to the counterparty — the notification side is already allow-listed. **Open for the owner:** should an invitation carry a one-time token so the first click claims? Today `shareUrl` is only the code in a link and the invitee must sign up with the invited address first.
