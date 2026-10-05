# Epic 11 — Park custody

Design §7. Park is a row in `logistics_companies` (`is_default`); Park Agents are members of it with per-hub permissions; custody lives in the `park` schema.

---

### T-090 — Park schema

- **Touches:** `src/modules/park/infrastructure/postgres/**`, migration `park_*`
- **Depends on:** T-085
- **Acceptance criteria:**
  - `park_hubs`, `park_hub_applications`, `park_hub_agents`, `park_parcels`, `park_custody_events`, `park_handover_pins` exactly as design §7.2, with hard same-schema FKs and soft refs to `logistics`, `trade` and `identity`.
  - Partial unique indexes: one live assignment per (hub, member); one live primary agent per hub; one live PIN per (parcel, leg); one parcel per trade; no duplicate live hub for the same operator, branch and address.
  - `can_release` requires an approving staff id (check constraint).
  - `park_custody_events` append-only by trigger and grants.
  - Parcel state machine as a pure `canTransition` with every valid and invalid transition tested, including origin = destination skipping `IN_TRANSIT` and `EXCEPTION` resuming the stored prior state.
  - The only price-like value anywhere is the config row `park.handling_fee_minor` (schema test).

### T-091 — Hub onboarding, activation and lifecycle

- **Touches:** `park/services/{application,activation,lifecycle,staff}.service.ts`, `park/http/{applicant,admin}.controller.ts`
- **Depends on:** T-090, T-086, T-050, T-073, T-107
- **Acceptance criteria:**
  - Consumer-scope applicant API for PH1–PH5, PA7 status and PA8 changes-requested resubmission; submit blocked without authorization evidence (mandatory photo gate) and identity evidence.
  - Staff API for TrustOps-led registration (TO-PA6, TO-PA6B, TO-PA10): hub draft and agent record created separately; NIN/BVN go through trust verification and are never stored raw.
  - Applications register as `PARK_HUB_APPLICATION` cases with an evidence matrix (identity, authority, hub details, payout name-match) and advisory (TO-PA1, TO-PA2, PH7).
  - Activation (TO-PA3) is one transaction: hub `ACTIVE`, Park membership (`OPERATOR`, `INVITED` until first logistics login), assignment rows with the exact permission flags, hub payout account linked. It is refused while any check is unresolved. Publishes `park.hub.created` and `park.hub.activated`.
  - Lifecycle (TO-PA4): suspend custody rights, request re-verification (authorization review date), change primary agent, temporarily close hub; every action needs a reason and keeps history. `park.hub.suspended` on suspension.
  - Hub staff invites by agents with `can_add_staff`; release rights for staff need TrustOps approval.
  - Every endpoint idempotent where retryable and paginated where it lists.

### T-092 — Custody operations API

- **Touches:** `park/services/{custody,pin,exception}.service.ts`, `park/http/agent.controller.ts`
- **Depends on:** T-091, T-040
- **Acceptance criteria:**
  - Agent routes require `LOGISTICS` scope, Park membership, and an active assignment with the needed flag for the hub; the hub is resolved server-side (tests: agent of hub A cannot act on hub B; a removed agent loses access on the next request).
  - Log arrival by trade code or waybill (U2), with leg detection (source drop-off or destination arrival); drop-off validates the seller's `DROPOFF` PIN.
  - Inspection (U3): seal state plus photo (`CUSTODY_EVIDENCE`), server timestamp and hub stamped on the event.
  - PINs: 4 digits from the unbiased generator, `pin_hash` (domain-separated HMAC) plus `pin_enc` for display to the rightful party only; validation is constant-time; three failed attempts lock the PIN, freeze release and open a custody case (U4, U5, TO-PA5).
  - Redis rate limits on PIN validation per parcel, per agent and per hub, on top of the attempt cap.
  - Damaged or tampered seal, or an incident report (PA10), moves the parcel to `EXCEPTION`, records the prior state and publishes `park.parcel.exception` (U6).
  - Scan arrival, inspection, PIN validation and exception logging are all retryable with `Idempotency-Key`; replaying any of them, including a replayed successful PIN validation, never double-counts attempts or double-releases (tests).
  - Events `park.parcel.received` (with leg), `park.parcel.inspected`, `park.parcel.exception`, `park.parcel.released`.

### T-093 — Park and trade integration

- **Touches:** `trades/services/fulfilment.service.ts` (Park branch), `park/services/parcel.service.ts`, `park/jobs/ageing.job.ts`
- **Depends on:** T-092, T-064, T-065
- **Acceptance criteria:**
  - Ship step "Park Hub Transit" (X2): choose destination hub (active and accepting) and optional origin hub; creates the parcel in `AWAITING_SOURCE_DROPOFF`, issues `DROPOFF` and `PICKUP` PINs, records waybill, carrier, driver phone and plate.
  - Seller sees the drop-off PIN; buyer sees the pickup PIN and hub address (AB1, AB2) through endpoints that reveal `pin_enc` only to that party.
  - Parcel `AT_SOURCE_HUB` moves the trade to `SHIPPED`; `park.parcel.released` feeds the shared delivery-signal consumer with source `PARK_CUSTODY` (trusted), moving the trade to `INSPECTION`.
  - `park.parcel.exception` places a `PARK_EXCEPTION` hold on the trade; clearing lifts it.
  - Ageing job opens a `CUSTODY` case past `park.custody_ageing_hours` and records ageing buckets.

### T-094 — Hub earnings and withdrawals

- **Touches:** `ledger` subscriber for `park.parcel.released`, `park/http/earnings.controller.ts`
- **Depends on:** T-093, T-073
- **Acceptance criteria:**
  - On release: debit `PARK_HANDLING_EXPENSE`, credit `HUB_PAYABLE(hub)` by the fee read from config at that moment; exactly once per parcel even on event replay (test).
  - Earnings API for PE1: available balance, period count, per-parcel fee, recent handovers, paginated.
  - Withdrawal via `executePayout` to the hub's verified payout account, allowed only for members with `can_manage_payouts`.
  - If the owner answers Q2 differently, only the debit account changes; the test suite covers the posting as a unit so the switch is one line.

### T-095 — Park TrustOps read models

- **Touches:** `park/http/admin.controller.ts`, `park/services/metrics.service.ts`
- **Depends on:** T-093, T-107
- **Acceptance criteria:**
  - All hubs (TO-PA7) with period filters and an explicit all-time lifetime intake; hub detail (TO-PA8) with held now, period intake, lifetime, release rate, custody state counts; hub team and permissions (P0-07).
  - Custody command centre (P0-04): parcels held, held over 24h, exceptions, hubs at capacity, ageing buckets, hub network table.
  - Parcel detail (P0-05): immutable custody timeline and accountability panel.
  - Incident decisions (TO-PA5): clear for another attempt (resets the lock with an audit reason), keep held and contact buyer, escalate (to dispute or hub review).
  - All lists paginated; metrics aggregated by scheduled jobs, not computed per request for network-wide views.
