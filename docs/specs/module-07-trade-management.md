# Kumtru — Module 7: Trade Management

**Implementation specification**
Version 0.1 · 20 August 2026 · Status: Draft for engineering review

---

## 0. How to read this document

This is the spine. Per M1 §20 and M6 §13, everything else in Core Commerce and Money is written in terms of this module's state machine — Merchant (M5), Orders (M9), Payment & Ledger (M8), Logistics (M2), and Disputes (M3) all reference a trade, not the other way around.

Two rules, restated from the original architecture blueprint because this is the module where violating them costs the most:

1. **The backend owns every state transition.** No client determines that an inspection period has expired, that a buyer clicked accept, or that a trade is eligible to complete. The frontend displays state; it never computes it.
2. **A trade never holds money.** It requests money movements. Payment & Ledger (M8) is the only module with an authoritative answer to "where is the money right now" — this module answers "what is happening," M8 answers "where is the money," and the two stay in sync through events, never through one module writing into the other's tables.

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Trade state machine | The full lifecycle, DRAFT through SETTLED, plus dispute and cancellation branches |
| Party binding | Resolving buyer/seller into verified `users` rows, including the M1 `party_invitations` handoff |
| Eligibility gates | What must be true (verification level, capability status) before a transition is allowed |
| Delivery-confirmation trust weighting | How self-reported, partner-reported, and buyer-confirmed delivery signals combine — see §6 |
| Inspection windows | Default durations, category overrides (deferred to Configuration, M17) |
| Escrow action requests | Emitting fund/release/refund *requests* to M8 — never touching money directly |
| Cancellation and expiry rules | What can be cancelled cleanly vs. what must go through a refund |
| Trade state audit log | Append-only record of every transition |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Payment & Ledger (M8) | Actual funds movement, the double-entry ledger, settlement, refund execution |
| Orders (M9) | Line items, multi-item fulfillment, partial shipment detail |
| Logistics (M2) | Raw shipment tracking events, courier/partner integration, the shipment timeline itself |
| Disputes (M3) | Evidence collection, dispute decisions, appeals — M7 only owns the `DISPUTED`/`UNDER_REVIEW` state slots and hands off |
| Merchant Management (M5) | Seller tier, store profile — M7 only checks *is this user allowed to sell*, via M1/M6 |
| Identity & Access (M1) | Party lookup, invitation delivery mechanics — M7 owns the trade-side state (`PENDING_COUNTERPARTY`), M1 owns the invitation record itself |
| Reputation (M12) | Completion rate, cancellation rate — M7 emits the raw events; M12 aggregates them |

> **Boundary note on Trade vs. Order:** a trade is the financial and trust container — who's involved, what state it's in, where the money is. An order is the fulfillment container — which items, which shipments, whether fulfillment is partial. M9 hasn't been specced yet at time of writing; this module treats `order_id` as a stable foreign key into M9's eventual schema and does not model items or shipments here. Don't let trade logic leak into item-level concerns, and don't let M9 reach back and set trade state directly — it requests transitions through the same event/API surface everything else uses.

---

## 2. Core design decisions

### D1 — One strict state machine, no client-side transitions

Every transition is a backend-validated function of (current state, action, actor, eligibility checks) → next state. There is no `PATCH /trades/:id` that accepts an arbitrary status. Every transition has its own endpoint (§9), because "can this actor do this specific thing right now" is a different question for every transition and deserves its own authorization check rather than one generic status-setter that has to reimplement all of them internally anyway.

### D2 — Counterparty binding is provisional until a real user exists

A seller can tag a buyer who isn't on Kumtru yet (M1 §8's `party_invitations` flow). The trade exists in `PENDING_COUNTERPARTY` from the moment it's created — never before, and never as a null-buyer trade floating with no reference at all. This matters for audit completeness: even a trade that never gets claimed leaves a full trail of who initiated it and who was invited.

### D3 — Funding is the only irreversible-without-a-refund-path event

Before `FUNDED`, a trade can be cancelled outright — no money has moved, cancelling is just a status change plus notifying the other party. From `FUNDED` onward, "cancelling" doesn't exist as a concept anymore; there is only refunding (which goes through the same dispute/resolution machinery as any other refund) or completing. This is a direct extension of M1 §8's own rule: *"a status change never cancels in-flight escrow."*

### D4 — Delivery confirmation is trust-weighted, not source-blind

See §6 in full. This is the design question flagged as open when Logistics (M2) requirements were first discussed — self-reported delivery claims (no courier partner exists at launch) can't carry the same weight as an independently-confirmed one, or a seller could unilaterally start the payment-release clock on a package that never shipped.

### D5 — The inspection window is the backstop, confirmation is the fast path

A buyer explicitly confirming receipt moves a trade to `INSPECTION` immediately and starts the clock. A buyer who never responds isn't stuck forever, and isn't giving a passive buyer veto power over a legitimate delivery either — an elapsed grace period converts an unconfirmed delivery into a confirmed one automatically (§6). The two paths converge on the same state; only the trigger differs.

### D6 — Every transition emits an event before anything downstream reacts

No module polls this one. Merchant, Reputation, Risk, Notifications, Tickets, Audit — all of them react to `trade.*` events, never to a direct call into this module's tables. This is the same EventEmitter/BullMQ split from Module 0 §4: the state transition itself is synchronous and transactional (a single DB write), but everything that happens *because* of it — notify the seller, update reputation stats, request a ledger action — runs through the event bus.

---

## 3. State machine

```
                    ┌──────────────────┐
                    │      DRAFT        │  seller building the offer, not yet sent
                    └────────┬──────────┘
                             │ seller sends
                             ▼
              ┌───────────────────────────┐
              │   PENDING_COUNTERPARTY     │◀── buyer tagged by @username/email,
              └────────────┬───────────────┘    not yet a resolvable verified user
                             │ M1 party_invitations.claimed
                             ▼
                  ┌───────────────────┐
                  │  PENDING_PAYMENT   │  counterparty resolved, awaiting funding
                  └─────────┬──────────┘
                             │ M8 confirms funds received
                             ▼
                       ┌───────────┐
                       │  FUNDED   │◀─────────────────────────┐  (D3: no cancellation past here)
                       └─────┬─────┘                          │
                             │ seller accepts                 │
                             ▼                                │
                    ┌─────────────────┐                       │
                    │ SELLER_ACCEPTED │                       │
                    └────────┬─────────┘                      │
                             ▼                                │
                    ┌─────────────────┐                       │
                    │  READY_TO_SHIP  │                       │
                    └────────┬─────────┘                      │
                             │ shipment created (M2)           │
                             ▼                                │
                       ┌───────────┐                          │
                       │  SHIPPED  │                          │
                       └─────┬─────┘                          │
                             ▼                                │
                     ┌──────────────┐                         │
                     │  IN_TRANSIT  │                         │
                     └──────┬────────┘                        │
                             │ delivery signal (§6)            │
              ┌──────────────┴───────────────┐                │
              ▼                              ▼                │
  ┌─────────────────────┐         ┌────────────────────┐      │
  │ UNCONFIRMED_DELIVERY │────────▶│      DELIVERED      │      │
  └──────────────────────┘  grace └──────────┬───────────┘      │
    buyer confirms ──────────────────────────┘                 │
                             │ inspection window starts        │
                             ▼                                │
                      ┌─────────────┐                          │
                      │ INSPECTION  │                          │
                      └──────┬───────┘                         │
              ┌───────────────┴────────────────┐               │
              │ window elapses / buyer accepts  │ buyer disputes│
              ▼                                 ▼               │
       ┌────────────┐                   ┌───────────────┐      │
       │ COMPLETED  │                   │   DISPUTED    │──────┘ (M3 takes over)
       └─────┬───────┘                   └───────┬────────┘
              │ M8 settles                        ▼
              ▼                           ┌────────────────┐
        ┌───────────┐                     │  UNDER_REVIEW   │
        │  SETTLED  │                     └────────┬─────────┘
        └───────────┘                               ▼
                                       ┌─────────────────────────┐
                                       │  RESOLVED_REFUNDED /      │
                                       │  RESOLVED_RELEASED        │
                                       └───────────────────────────┘

  Any state before FUNDED  ──cancel──▶  CANCELLED
  PENDING_COUNTERPARTY, unclaimed after 14 days (M1 §8)  ──▶  EXPIRED
```

---

## 4. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS trade;
SET search_path TO trade, public;
```

### 4.1 Enumerations

```sql
CREATE TYPE trade_status AS ENUM (
  'DRAFT', 'PENDING_COUNTERPARTY', 'PENDING_PAYMENT', 'FUNDED',
  'SELLER_ACCEPTED', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT',
  'UNCONFIRMED_DELIVERY', 'DELIVERED', 'INSPECTION', 'COMPLETED',
  'SETTLED', 'DISPUTED', 'UNDER_REVIEW', 'RESOLVED_REFUNDED',
  'RESOLVED_RELEASED', 'CANCELLED', 'EXPIRED'
);

CREATE TYPE delivery_signal_source AS ENUM (
  'SELLER_SELF_REPORT', 'BUYER_CONFIRMATION', 'PARTNER_PORTAL', 'COURIER_API'
);

CREATE TYPE escrow_action_type AS ENUM ('FUND', 'RELEASE', 'REFUND', 'PARTIAL_REFUND');

CREATE TYPE escrow_action_status AS ENUM ('REQUESTED', 'ACKNOWLEDGED', 'COMPLETED', 'FAILED');

CREATE TYPE cancellation_reason AS ENUM (
  'BUYER_WITHDREW', 'SELLER_WITHDREW', 'COUNTERPARTY_INVITE_EXPIRED',
  'MUTUAL_AGREEMENT', 'FRAUD_SUSPECTED', 'SYSTEM_TIMEOUT'
);
```

### 4.2 Trades — the core record

```sql
CREATE TABLE trades (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id             text NOT NULL UNIQUE,   -- 'KMT-92831', human-facing, safe to expose

  buyer_user_id         uuid,        -- soft ref to identity.users(id); null until D2 resolves
  seller_user_id        uuid NOT NULL,   -- soft ref to identity.users(id) — always a real user

  -- D2: how the buyer got attached. Exactly one of these is set at any time.
  buyer_invitation_id   uuid,        -- soft ref to identity.party_invitations(id)

  order_id              uuid,        -- soft ref to M9's eventual order record

  status                trade_status NOT NULL DEFAULT 'DRAFT',
  status_reason         text,

  amount_minor          bigint NOT NULL,    -- kobo, never a float
  currency              text NOT NULL DEFAULT 'NGN',

  inspection_window_hours integer NOT NULL DEFAULT 72,   -- default; M17 may override per category
  delivery_grace_hours    integer NOT NULL DEFAULT 48,     -- D5's grace window

  terms                 jsonb,       -- seller-authored terms shown to buyer at DRAFT

  created_at            timestamptz NOT NULL DEFAULT now(),
  sent_at               timestamptz,
  counterparty_bound_at timestamptz,
  funded_at             timestamptz,
  seller_accepted_at    timestamptz,
  shipped_at            timestamptz,
  delivery_signaled_at  timestamptz,
  delivery_confirmed_at timestamptz,
  inspection_started_at timestamptz,
  inspection_deadline_at timestamptz,
  completed_at          timestamptz,
  settled_at            timestamptz,
  cancelled_at           timestamptz,
  cancellation_reason    cancellation_reason,
  expired_at             timestamptz,

  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT trade_buyer_xor_invitation CHECK (
    (buyer_user_id IS NOT NULL AND buyer_invitation_id IS NULL)
    OR (buyer_user_id IS NULL AND buyer_invitation_id IS NOT NULL)
  ),
  CONSTRAINT trade_amount_positive CHECK (amount_minor > 0)
);

CREATE INDEX trades_buyer_idx ON trades (buyer_user_id);
CREATE INDEX trades_seller_idx ON trades (seller_user_id);
CREATE INDEX trades_status_idx ON trades (status);
CREATE INDEX trades_inspection_deadline_idx
  ON trades (inspection_deadline_at) WHERE status = 'INSPECTION';
```

> `buyer_user_id` and `seller_user_id` are soft references to `identity.users(id)`, the same pattern M6 uses — separate schema, application-enforced, no hard cross-schema FK (see M6 §6.2's note on why).

### 4.3 State transition audit log (append-only, same pattern as M1 §5.11 / M6 §6.11)

```sql
CREATE TABLE trade_state_changes (
  id              bigserial PRIMARY KEY,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  trade_id        uuid NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  from_status     trade_status,
  to_status       trade_status NOT NULL,
  actor_type      text NOT NULL,   -- 'BUYER'|'SELLER'|'SYSTEM'|'ADMIN'|'M8'|'M2'
  actor_id        uuid,
  reason          text,
  metadata        jsonb
);

CREATE INDEX trade_state_changes_trade_idx
  ON trade_state_changes (trade_id, occurred_at);

GRANT INSERT, SELECT ON trade_state_changes TO kumtru_app;
GRANT USAGE, SELECT ON SEQUENCE trade_state_changes_id_seq TO kumtru_app;

CREATE FUNCTION trade_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'trade_state_changes is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trade_audit_no_mutate
  BEFORE UPDATE OR DELETE ON trade_state_changes
  FOR EACH STATEMENT EXECUTE FUNCTION trade_audit_immutable();
```

### 4.4 Delivery signals (D4/D5, expanded in §6)

```sql
CREATE TABLE delivery_signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id        uuid NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  source          delivery_signal_source NOT NULL,
  reported_by     uuid,   -- user id if BUYER_CONFIRMATION/SELLER_SELF_REPORT
  shipment_event_id uuid,  -- soft ref to M2's shipment_status_events, if PARTNER_PORTAL/COURIER_API
  reported_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX delivery_signals_trade_idx ON delivery_signals (trade_id);
```

### 4.5 Escrow action requests (D1/D6 — never touches money, only requests it)

```sql
CREATE TABLE escrow_action_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id        uuid NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  action          escrow_action_type NOT NULL,
  amount_minor    bigint NOT NULL,
  status          escrow_action_status NOT NULL DEFAULT 'REQUESTED',
  requested_at    timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,   -- M8 has seen the request
  completed_at    timestamptz,   -- M8 confirms the ledger entry landed
  failure_reason  text,
  ledger_ref      text    -- M8's own reference, once completed
);

CREATE INDEX escrow_action_requests_trade_idx ON escrow_action_requests (trade_id);
CREATE INDEX escrow_action_requests_pending_idx
  ON escrow_action_requests (status) WHERE status IN ('REQUESTED', 'ACKNOWLEDGED');
```

---

## 5. Eligibility gates

Every transition endpoint (§9) runs its transition-specific gate before touching state. The gates that matter most:

| Transition | Gate |
|---|---|
| `DRAFT → PENDING_COUNTERPARTY` | Seller holds an `ACTIVE` `SELLER` capability (M1 §5.7) — checked live, not cached |
| `PENDING_PAYMENT → FUNDED` | Buyer's `verification_level ≥ CONTACT_VERIFIED` (M1 level 1) — funding is a level-1 action per M1 §2's table |
| `FUNDED → SELLER_ACCEPTED` | Seller's `verification_level ≥ IDENTITY_VERIFIED` (M6 level 2) — a trade can be *funded* toward a seller who somehow lost verified status, but cannot *proceed* until that's resolved. This is the concrete case M1's own §8 rule anticipates: identity status changes never cancel in-flight escrow; they gate the *next* action only |
| `→ SHIPPED` | An M2 shipment record exists and references this trade |
| `INSPECTION → COMPLETED` | Either the window has elapsed or the buyer explicitly accepted — never a seller-initiated transition |
| any `→ CANCELLED` | Current status is strictly before `FUNDED` (D3) |
| `→ DISPUTED` | Current status is one of `SHIPPED`, `IN_TRANSIT`, `UNCONFIRMED_DELIVERY`, `DELIVERED`, `INSPECTION` — a buyer can't dispute a trade that was never funded, and can't dispute one that's already `SETTLED` (that's a different M3 flow: post-settlement claims, out of scope here) |

If a seller's capability or a buyer's verification level is re-checked and fails at a gate, the trade does not silently fail — it stays in its current state and the actor sees an explicit, specific error (`SELLER_NOT_VERIFIED`, not a generic 403). The eligibility failure itself is worth an event (`trade.eligibility_blocked`) so Risk (M13) sees a pattern if it happens repeatedly for the same account.

---

## 6. Delivery-confirmation trust weighting (D4/D5, expanded)

This resolves the open question flagged when Logistics (M2) requirements were first scoped: Kumtru launches with no courier partners, so most delivery signals will be self-reported. The state machine cannot treat a lone seller claim the same as an independently-confirmed one, or "mark as shipped, mark as delivered" becomes a two-click way to start the payment-release clock on an empty box.

```
Delivery signal arrives (from M2, tagged with its source)
        │
        ▼
   What's the source?
        │
   ┌────┴─────────────────┬───────────────────────┐
   │                       │                        │
BUYER_               PARTNER_PORTAL /         SELLER_SELF_REPORT
CONFIRMATION          COURIER_API                    │
   │                       │                          │
   ▼                       ▼                          ▼
Transition to        Transition to             Transition to
DELIVERED             DELIVERED                UNCONFIRMED_DELIVERY
immediately.          immediately.              │
Strongest signal      Independent third          Notify buyer: "seller
— it's the buyer      party attesting —          says this shipped —
saying "I have        treated as reliable        confirm receipt or
this."                 as buyer confirmation.      dispute."
                                                    │
                                          delivery_grace_hours elapses
                                          with no buyer dispute
                                                    │
                                                    ▼
                                          Auto-transition to DELIVERED,
                                          reason='GRACE_PERIOD_ELAPSED'.
                                          Inspection window starts from
                                          here, same as any other path.
```

**Why auto-convert after the grace period instead of requiring explicit buyer confirmation always?** Because the alternative gives a silent or inattentive buyer indefinite veto power over releasing funds to a seller who may have genuinely shipped and delivered. That's not a safer default — it just moves the failure mode from "seller could theoretically lie" to "buyer can stall forever, for free, with no cost to them." The grace period (default 48h, §4.2) plus the subsequent inspection window (default 72h) gives a buyer 5 days total between a seller's shipped-claim and money moving, with an explicit dispute button available the entire time. If the buyer disputes at any point before `COMPLETED`, the trade goes to `DISPUTED` (M3) and the release clock stops entirely.

**One-time partner-portal exception:** once a shipment has any `PARTNER_PORTAL` or `COURIER_API` signal anywhere in its history (i.e., a real courier is involved, even if the *final* delivery confirmation happens to come in as a self-report because the courier's portal update lagged), a subsequent `SELLER_SELF_REPORT` for the same trade is treated with the same weight as partner confirmation — the courier's involvement earlier in the chain is itself corroboration. This avoids punishing a legitimate courier-fulfilled order for a portal update that arrived late.

---

## 7. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `trade.created` | tradeId, sellerId, status | Notifications |
| `trade.counterparty_bound` | tradeId, buyerId | Notifications, M1 (marks invitation claimed) |
| `trade.funded` | tradeId, amount | M8 (acknowledges), Notifications, Reputation |
| `trade.seller_accepted` | tradeId | Notifications |
| `trade.shipped` | tradeId, orderId | Notifications, M2 |
| `trade.delivery_signal_received` | tradeId, source | Internal — drives §6's logic |
| `trade.delivered` | tradeId, source, wasGracePeriod | Notifications, M12 |
| `trade.inspection_started` | tradeId, deadlineAt | Notifications |
| `trade.completed` | tradeId | M8 (triggers RELEASE), Reputation, Audit |
| `trade.settled` | tradeId, ledgerRef | Notifications, Reputation, Audit |
| `trade.disputed` | tradeId, initiatorId | M3 (creates the dispute case), Notifications, Risk |
| `trade.cancelled` | tradeId, reason | Notifications, Reputation |
| `trade.expired` | tradeId | Notifications, M1 (invitation already expired independently) |
| `trade.eligibility_blocked` | tradeId, gate, actorId | Risk (M13), Audit |

Per Module 0 §4's rule: in-process emission for fan-out, but anything requiring external I/O (the notification send itself, the M8 ledger call) goes through a BullMQ job from the handler — never inline in the event listener.

---

## 8. RBAC — this module's slice of M1's baseline

M1 §12 already defines the relevant roles. This module's permissions:

```
trade.view
trade.view_all          -- admin: any trade, not just own
trade.cancel_override    -- admin force-cancel, dual-approval per M1's pattern
trade.dispute_escalate   -- OPERATIONS_ADMIN/DISPUTE_REVIEWER pulling a trade into review early
```

A buyer and seller each act on their own trades through the ordinary API surface (§9) — no special role needed for the actions a counterparty is entitled to take on their own trade. These permissions are for the admin surface only.

---

## 9. API surface

Per M1 §26's rule — domains, not screens. Mobile and web call the same endpoints:

```
POST   /trades                          create (DRAFT)
POST   /trades/:id/send                  DRAFT → PENDING_COUNTERPARTY or PENDING_PAYMENT
POST   /trades/:id/fund                  PENDING_PAYMENT → FUNDED (M8 webhook only)
POST   /trades/:id/accept                FUNDED → SELLER_ACCEPTED
POST   /trades/:id/ready-to-ship         SELLER_ACCEPTED → READY_TO_SHIP
POST   /trades/:id/ship                  READY_TO_SHIP → SHIPPED (requires M2 shipment ref)
POST   /trades/:id/confirm-delivery       buyer-initiated DELIVERED (§6)
POST   /trades/:id/accept-inspection       INSPECTION → COMPLETED, buyer-initiated
POST   /trades/:id/dispute                 → DISPUTED, hands off to M3
POST   /trades/:id/cancel                  → CANCELLED, gated by D3
GET    /trades/:id
GET    /trades/:id/history                 full trade_state_changes trail

# Admin
GET    /admin/trades
POST   /admin/trades/:id/force-cancel        dual-approval, see §8
```

`POST /trades/:id/fund` deserves a specific callout: it is never called directly by a mobile or web client. It's invoked by M8's payment-webhook handler once a payment provider confirms funds received. A client-callable "mark as funded" endpoint would be exactly the kind of business-critical-logic-in-the-frontend the original architecture blueprint explicitly warned against.

---

## 10. What I would specify next

Per M1 §20 / M6 §13's ordering: **Payment, Escrow & Ledger (M8)** next — this module has been requesting escrow actions (§4.5) into a module that doesn't exist yet as a formal spec, and M8 is where a design mistake is most expensive to unwind. Notifications (M11) after that, since both M6 and this module already lean on it for delivery — every module so far has been accumulating notification requirements without a place to formally define delivery guarantees, retries, or channel selection.
