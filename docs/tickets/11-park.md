# Epic 11 — Park custody

Design §7. Park is a row in `logistics_companies` (`is_default`); Park Agents are members of it with per-hub permissions; custody lives in the `park` schema.

---

### T-090 — Park schema

- **Touches:** `src/modules/park/infrastructure/postgres/**`, migration `park_*`
- **Depends on:** T-085, T-046
- **Acceptance criteria:**
  - `park_hubs`, `park_hub_applications`, `park_hub_agents`, `park_parcels`, `park_custody_events`, `park_handover_pins` exactly as design §7.2, with hard same-schema FKs and soft refs to `logistics`, `trade` and `identity`.
  - Partial unique indexes: one live assignment per (hub, member); one live primary agent per hub; one live PIN per (parcel, leg); one parcel per trade; no duplicate live hub for the same operator, branch and address.
  - `can_release` requires an approving staff id (check constraint).
  - `park_custody_events` append-only by trigger and grants.
  - Parcel state machine as a pure `canTransition` with every valid and invalid transition tested, including origin = destination skipping `IN_TRANSIT` and `EXCEPTION` resuming the stored prior state.
  - No price, fee or payout column exists anywhere in the `park` schema (schema test, design C23). Permission flags are `can_receive`, `can_inspect`, `can_release`, `can_add_staff`.
  - `park_hubs` stores `city_id` (soft reference to the location catalog), street address, landmark, optional GPS coordinates and operating hours; index on `city_id` for active, open hubs. The duplicate-hub guard uses the city rather than free text.

### T-091 — Hub onboarding, activation and lifecycle

- **Touches:** `park/services/{application,activation,lifecycle,staff}.service.ts`, `park/http/{applicant,admin}.controller.ts`
- **Depends on:** T-090, T-086, T-050, T-107
- **Acceptance criteria:**
  - Consumer-scope applicant API for PH1–PH5, PA7 status and PA8 changes-requested resubmission; submit blocked without authorization evidence (mandatory photo gate) and identity evidence.
  - Staff API for TrustOps-led registration (TO-PA6, TO-PA6B, TO-PA10): hub draft and agent record created separately; NIN/BVN go through trust verification and are never stored raw.
  - Applications register as `PARK_HUB_APPLICATION` cases with an evidence matrix (identity, authority, hub details) and advisory (TO-PA1, TO-PA2, PH7).
  - Activation (TO-PA3) is one transaction: hub `ACTIVE`, Park membership (`OPERATOR`, `INVITED` until first logistics login), assignment rows with the exact permission flags. No bank or payout details are collected. It is refused while any check is unresolved. Publishes `park.hub.created` and `park.hub.activated`.
  - Lifecycle (TO-PA4): suspend custody rights, request re-verification (authorization review date), change primary agent, temporarily close hub; every action needs a reason and keeps history. `park.hub.suspended` on suspension.
  - Hub staff invites by agents with `can_add_staff`; release rights for staff need TrustOps approval.
  - Every endpoint idempotent where retryable and paginated where it lists.
  - Both onboarding paths require a catalog city; staff with `geo.manage` can add a missing city inline during TrustOps registration. Hubs in onboarding are visible to TrustOps as upcoming coverage but never offered to customers.

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
  - Coverage service per design §7.8: a city is serviceable when it has a hub that is `ACTIVE` and `OPEN` with at least one `ACTIVE` agent holding `can_receive` and `can_release`; results cached in Redis and invalidated by hub and agent events.
  - `GET /park/coverage` (serviceable cities, paginated) and `GET /park/coverage/cities/:cityId/hubs`; parcel creation re-checks both trade cities and returns `409 PARK_NOT_AVAILABLE_IN_CITY` when either is not serviceable.
  - The destination hub must be in the delivery city and the origin hub in the ships-from city (validated server-side).
  - Suspending or closing a hub with parcels headed to it opens a custody case per parcel for redirection.
  - Tests: Jos with no hub rejects Park; a Jos hub in onboarding still rejects it; activating a Jos hub with a release-capable agent allows it; suspending that agent removes it again.

### T-094 — Park cash-fee notices and handover log

- **Touches:** `park/http/{fees,handovers}.controller.ts`, notify templates
- **Depends on:** T-093, T-047
- **Acceptance criteria:**
  - The `park_cash_handling_fee` range from the fee file is exposed on the trade and parcel read models once Park is chosen, with copy stating it is paid in cash to the agent at pickup and not through Komtru (design §7.7).
  - The "parcel arrived at the hub" notification to the buyer includes the cash-fee notice and the hub address.
  - Handover log API for PE1: counts per period and recent releases, paginated, with no money values.
  - A test asserts `park.parcel.released` produces zero ledger postings and that no Park code reads the fee for anything but display.

### T-095 — Park TrustOps read models

- **Touches:** `park/http/admin.controller.ts`, `park/services/metrics.service.ts`
- **Depends on:** T-093, T-107
- **Acceptance criteria:**
  - All hubs (TO-PA7) with period filters and an explicit all-time lifetime intake; hub detail (TO-PA8) with held now, period intake, lifetime, release rate, custody state counts; hub team and permissions (P0-07).
  - Custody command centre (P0-04): parcels held, held over 24h, exceptions, hubs at capacity, ageing buckets, hub network table.
  - Parcel detail (P0-05): immutable custody timeline and accountability panel.
  - Incident decisions (TO-PA5): clear for another attempt (resets the lock with an audit reason), keep held and contact buyer, escalate (to dispute or hub review).
  - All lists paginated; metrics aggregated by scheduled jobs, not computed per request for network-wide views.
  - Coverage view data: serviceable cities by state, hubs per city, cities with hubs in onboarding, and cities where trades requested Park but none was available (demand signal from rejected ship-step checks).
