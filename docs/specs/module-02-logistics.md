# Kumtru — Module 2: Logistics

**Implementation specification**
Version 0.1 · 20 August 2026 · Status: Draft for engineering review

---

## 0. How to read this document

This module exists to satisfy a requirement Emmanuel stated directly during the architecture discussion: **Kumtru will not have logistics partners at launch.** Buyers and sellers will be the ones reporting where a shipment actually is, at every step, because there's no courier API to ask. But the system has to be built so that when partners are onboarded later, they slot into the exact same data model — not a rebuild, not a migration that reshapes history, just a new source type showing up in an already-designed field.

That single requirement is why this module's central object isn't "a courier's tracking record" but a **provenance-tagged timeline**: every milestone (picked up, in transit, delivered) carries a `source` field saying who reported it — the seller by hand, the buyer by hand, a logistics partner through their portal, or eventually a courier's API. Trade Management (M7 §6) already consumes exactly this vocabulary for its delivery-confirmation trust weighting (buyer confirmation or partner/courier signal → immediate `DELIVERED`; seller-only self-report → a 48-hour grace period) — this module is what produces the signal M7 reacts to, translated through Orders (M9) in between.

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Shipments | The per-order-item shipment record, present whether or not a partner is assigned |
| Manual milestone reporting | Buyer/seller self-report endpoints — the only path that exists at launch |
| Provenance-tagged timeline | Every milestone update tagged with who/what reported it |
| Logistics partners | Partner accounts, onboarding status — schema ready even though the roster starts empty |
| Partner portal (4th client surface) | Pickup requests, partner-side milestone reporting — API-complete from day one, UI built when the first partner is onboarded |
| Future courier API slot | A `source` value and webhook shape reserved, not built |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Orders (M9) | Order-item fulfillment status — M2 emits raw shipment events, M9 translates them (per M9 §5's own description of this exact boundary) |
| Trade Management (M7) | Delivery-confirmation trust weighting and the 48h grace period — M2 supplies the signal, M7 owns the decision |
| Merchant Management (M5) | What was sold — M2 only knows an `order_item_id` |
| File & Evidence Management (M20) | Proof-of-delivery photos — M2 stores a reference |

> **Boundary note:** M2 answers *"where is this shipment, and who says so?"* It deliberately does not answer *"is this trade's delivery therefore confirmed?"* — that's M7's call, informed by M2's data but made in M7's state machine. Keeping that split means M2 can be simple (record milestones, tag their source) without also having to encode M7's trust-weighting logic a second time.

---

## 2. Core design decisions

### D1 — A shipment record exists regardless of whether a partner is assigned

`shipments.carrier_type` is `MANUAL`, `PARTNER`, or `COURIER_API`. Every order item that reaches `READY_TO_SHIP` (M9) gets a shipment row immediately, defaulting to `MANUAL` — there's no "shipment doesn't exist yet because no partner picked it up" state, because at launch no partner ever will. The absence of a partner is the normal case, not an edge case.

### D2 — Every timeline event carries the same provenance vocabulary M7 already consumes

`shipment_events.source` uses exactly the four values M7 §6 was written against: `BUYER_CONFIRMATION`, `SELLER_SELF_REPORT`, `PARTNER_PORTAL`, `COURIER_API`. This isn't a coincidence to maintain by convention — it's the same enum, so a future engineer can't accidentally introduce a fifth source type in M2 that M7's trust-weighting logic doesn't know how to weigh.

### D3 — Milestones are a fixed enum, not free text, regardless of who reports them

`PICKED_UP`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `DELIVERY_FAILED`, `RETURNED_TO_SELLER` — the same six milestones whether a seller taps a button or a courier's webhook fires. Downstream consumers (M9, M7) branch on milestone and source independently instead of needing per-partner-integration parsing logic.

### D4 — The partner portal is API-complete before it has a UI or a first partner

Partner authentication (`logistics_partners`, a role distinct from consumer/seller/admin per M1's RBAC model), pickup-request creation, and partner-side milestone reporting all exist in this spec now. Nothing here is placeholder-only. When the first real partner is onboarded, the work is building their-facing UI and running an onboarding conversation — not designing new endpoints under deadline pressure.

### D5 — Reassigning a shipment from manual to partner-managed is a tracked event, never a silent field update

If a partner is onboarded mid-flight and takes over a shipment that started as manual, `shipments.carrier_type` changes — but that change itself is logged (§3.4), same append-only discipline as every other module's status-change tables. A shipment's history should always explain itself.

---

## 3. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS logistics;
SET search_path TO logistics, public;
```

### 3.1 Enumerations

```sql
CREATE TYPE carrier_type AS ENUM ('MANUAL', 'PARTNER', 'COURIER_API');

CREATE TYPE shipment_milestone AS ENUM (
  'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY',
  'DELIVERED', 'DELIVERY_FAILED', 'RETURNED_TO_SELLER'
);

CREATE TYPE update_source AS ENUM (
  'BUYER_CONFIRMATION', 'SELLER_SELF_REPORT', 'PARTNER_PORTAL', 'COURIER_API'
);

CREATE TYPE partner_status AS ENUM ('PENDING_ONBOARDING', 'ACTIVE', 'SUSPENDED');

CREATE TYPE pickup_request_status AS ENUM ('REQUESTED', 'ACCEPTED', 'DECLINED', 'COMPLETED');
```

### 3.2 Shipments

```sql
CREATE TABLE shipments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id   uuid NOT NULL,   -- soft ref to orders.order_items(id), M9
  carrier_type    carrier_type NOT NULL DEFAULT 'MANUAL',   -- D1
  partner_id      uuid,   -- set once assigned; null at launch for all shipments
  current_milestone shipment_milestone,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shipments_order_item_idx ON shipments (order_item_id);
CREATE INDEX shipments_partner_idx ON shipments (partner_id) WHERE partner_id IS NOT NULL;
```

### 3.3 Timeline events (append-only, D2/D3)

```sql
CREATE TABLE shipment_events (
  id              bigserial PRIMARY KEY,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  shipment_id     uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  milestone       shipment_milestone NOT NULL,
  source          update_source NOT NULL,
  reported_by_user_id uuid,   -- set for BUYER_CONFIRMATION / SELLER_SELF_REPORT
  partner_id      uuid,       -- set for PARTNER_PORTAL
  note            text,
  proof_file_ref_id uuid   -- soft ref to M20, e.g. a delivery photo
);

CREATE INDEX shipment_events_shipment_idx ON shipment_events (shipment_id, occurred_at);
```

### 3.4 Carrier reassignment log (D5)

```sql
CREATE TABLE shipment_carrier_changes (
  id            bigserial PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  shipment_id   uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  from_carrier  carrier_type NOT NULL,
  to_carrier    carrier_type NOT NULL,
  reason        text
);
```

### 3.5 Logistics partners and pickup requests (D4)

```sql
CREATE TABLE logistics_partners (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  contact_email   text NOT NULL,
  contact_phone   text,
  status          partner_status NOT NULL DEFAULT 'PENDING_ONBOARDING',
  api_key_hash    text,   -- populated only when COURIER_API integration begins
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pickup_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id     uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  partner_id      uuid NOT NULL REFERENCES logistics_partners(id),
  status          pickup_request_status NOT NULL DEFAULT 'REQUESTED',
  requested_at    timestamptz NOT NULL DEFAULT now(),
  responded_at    timestamptz
);

CREATE INDEX pickup_requests_partner_idx ON pickup_requests (partner_id, status);
```

---

## 4. The unified timeline

```
GET /shipments/:id/timeline returns shipment_events ordered by occurred_at,
each row showing milestone + source together:

  09:10  PICKED_UP           source: SELLER_SELF_REPORT   by seller
  14:02  IN_TRANSIT          source: SELLER_SELF_REPORT   by seller
  16:40  OUT_FOR_DELIVERY    source: PARTNER_PORTAL        by [Partner X]  <- after
                                                             mid-flight handoff (D5)
  17:15  DELIVERED           source: BUYER_CONFIRMATION    by buyer

Same UI component renders every row identically regardless of source — the
provenance tag is metadata for trust-weighting (M7) and display ("confirmed
by buyer" vs "reported by seller"), never a different code path per source.
```

---

## 5. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `shipment.created` | shipmentId, orderItemId, carrierType | Orders (M9) |
| `shipment.milestone_reported` | shipmentId, milestone, source, reportedByUserId or partnerId | Orders (M9, translates to `order.item_shipped`/`order.item_delivered`), Notifications |
| `shipment.carrier_reassigned` | shipmentId, fromCarrier, toCarrier | Orders, Audit |
| `shipment.pickup_requested` | pickupRequestId, shipmentId, partnerId | Notifications (to partner) |
| `shipment.pickup_accepted` | pickupRequestId | Orders, Notifications |

---

## 6. API surface

```
# Consumer app (buyer/seller) — the only path that exists at launch
POST   /shipments/:id/report-milestone       body: {milestone}, source inferred
                                              from caller role (seller → SELLER_SELF_REPORT,
                                              buyer confirming DELIVERED → BUYER_CONFIRMATION)
GET    /shipments/:id/timeline

# Partner portal (4th client surface) — API-complete now, built ahead of need (D4)
POST   /partner/auth/login
GET    /partner/pickup-requests
POST   /partner/pickup-requests/:id/accept
POST   /partner/pickup-requests/:id/decline
POST   /partner/shipments/:id/report-milestone   source = PARTNER_PORTAL

# Reserved, not implemented at launch
POST   /internal/courier-webhooks/:providerCode  source = COURIER_API

# Admin
POST   /admin/logistics-partners                 onboard a new partner
POST   /admin/shipments/:id/reassign-carrier      D5
```

---

## 7. What I would specify next

Continuing M1 §20's list: **Disputes (M3, full depth)** — the last of the marketplace-mechanics trio, and the one module that reads deeply from nearly everything written so far (M7's state machine, M8's ledger, M9's orders, M2's shipment timeline as evidence).
