# Epic 07 — Trades and orders (M7, M9)

State machine: design §6 (decision C1). Trades never touch money; they request it from the ledger through events.

---

### T-060 — Trade schema, state machine and audit

- **Touches:** `src/modules/trades/{domain,infrastructure}/**`, migration `trade_*`
- **Depends on:** T-024, T-025, T-030
- **Acceptance criteria:**
  - Tables: `trades`, `trade_terms_versions` (each proposal or counter-proposal is a new immutable version; the accepted version is pinned), `trade_state_changes` (append-only), `trade_activity` (append-only lifecycle log, resolves m2 §13.1), `delivery_signals` (source enum `BUYER_CONFIRMATION`, `SELLER_SELF_REPORT`, `PARTNER_PORTAL`, `PARK_CUSTODY`, `COURIER_API`), `escrow_action_requests`, `trade_holds`, `trade_deadlines`.
  - Trade codes in the HTML format (`KMT-88213`), unique, non-sequential.
  - Pure `canTransition(action, from)` covering every transition in design §6.2; unit tests for every valid transition and at least one invalid jump per state; services return `409 INVALID_TRANSITION`.
  - `trades.initiator_role` (`BUYER` or `SELLER`) recorded on every trade.
  - Eligibility gates per design §6.3: no `SELLER` capability gate; `canActAsBuyer` wherever a user would become the buyer (`403 MERCHANT_CANNOT_BUY`); buyer level 1 at funding; seller level 2 before funding. Each fails with a specific error and publishes `trade.eligibility_blocked`. Tests cover a merchant trying each buyer path and a merchant's in-flight buyer trade completing after certification.
  - `inspection_window_hours` and `delivery_grace_hours` are integers snapshotted from Trade Standards (resolves m2 §13.3).

### T-061 — Proposal flow

- **Touches:** `trades/services/{proposal,trade}.service.ts`, `trades/http/**`
- **Depends on:** T-060, T-035, T-049, T-040, T-047
- **Acceptance criteria:**
  - The initiator chooses `initiatorRole` on every trade; a certified merchant is forced to `SELLER`. Item spec validated against the category's Trade Standards (G1, Z2); live contract preview data (Z3).
  - Naming a certified merchant as the buyer is rejected before send, and the counterparty's `canBuy` is checked again at acceptance and invitation claim.
  - Send: counterparty by `@username`, email or phone via party lookup; non-users get a party invitation and the trade sits in `PENDING_COUNTERPARTY` until claimed or expired after 14 days.
  - Seller proof media is mandatory before a trade can reach `PENDING_PAYMENT`: attached at send time for a seller-initiated proposal, or at acceptance when the seller accepts a buyer's proposal (W1, where Accept stays disabled until media is attached); counter-proposal creates a new terms version and flips the turn (W2, BR1); decline with reason (SD1); cancel before funding (CT1).
  - "Do not ship yet" state after acceptance (W3) is `PENDING_PAYMENT`. Acceptance snapshots the fee schedule version and computed fees onto the trade (T-047), so the buyer sees the exact total before funding.
  - Every action is idempotent, writes state changes and activity, and publishes events.

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

### T-065 — Inspection and completion

- **Touches:** `trades/services/inspection.service.ts`, `trades/jobs/**`
- **Depends on:** T-064
- **Acceptance criteria:**
  - Inspection window from the snapshot; buyer may request more time once (BEI1), seller sees and responds (BEI2).
  - Compare seller's proof with delivery evidence (Z4 data); confirm and release with explicit acknowledgement (Z5) moves to `COMPLETED`; the window elapsing auto-completes (AR1) unless a hold or dispute exists.
  - Unconfirmed-delivery grace auto-converts per M7 §6.
  - `trade.completed` triggers the ledger release; `payment.escrow_released` moves the trade to `SETTLED`.

### T-066 — Post-funding cancellation and can't-fulfil refunds

- **Touches:** `trades/services/cancellation.service.ts`
- **Depends on:** T-064, T-075
- **Acceptance criteria:**
  - Buyer requests cancellation before shipment (CR1); seller approves or declines (CR2); approval requests a full refund (CR3) and moves to `CANCELLED_REFUNDED`.
  - Seller can't fulfil (SC1) refunds automatically (SC2).
  - Pre-funding cancellation stays a plain status change (M7 D3).

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
