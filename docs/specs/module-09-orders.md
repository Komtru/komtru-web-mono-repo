# Kumtru — Module 9: Orders

**Implementation specification**
Version 0.1 · 20 August 2026 · Status: Draft for engineering review

---

## 0. How to read this document

Trade Management (M7) already carries an `order_id` placeholder — this module is what that foreign key eventually points to. Read alongside M7 §1's boundary note: a trade is the financial/trust container (who, what state, where the money is); an order is the fulfillment container (which items, which shipments, whether fulfillment is partial). Don't let the two state machines compete — M7 owns the trade's lifecycle; this module's order status is a *derived* view of item-level fulfillment, never an independent thing M7 has to reconcile against.

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Orders | The fulfillment container a trade points to |
| Order items | Line items, snapshot pricing, quantity |
| Fulfillment status | Per-item, aggregated to an order-level view |
| Partial fulfillment | An order where some items have shipped and others haven't |
| Shipment association | Linking order items to M2 shipment records (M2 owns the shipment itself) |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Trade Management (M7) | Financial state, escrow, dispute/cancellation eligibility |
| Logistics (M2) | The actual shipment record, tracking events, courier/partner integration |
| Merchant Management (M5) | The live listing/product catalog an order item was created from |

> **Boundary note:** an order item stores a *snapshot* of what was purchased (§3.2's `listing_snapshot`), never a live reference to M5's mutable listing. If a seller edits their listing's price or description after a sale, every already-placed order must still reflect exactly what the buyer agreed to at purchase time — this is the same principle M1 applied to usernames (§6.4's snapshot rule: never resolve a historical value at read time).

---

## 2. Core design decisions

### D1 — One order per trade for now, schema leaves room for more

`orders.trade_id` is unique at launch — every funded trade produces exactly one order. The schema doesn't hard-code that assumption anywhere else (no order-specific financial fields, no order-level escrow logic), so relaxing the uniqueness constraint later — e.g. a single trade spanning a split fulfillment modeled as two orders — doesn't require a redesign, just a constraint change plus M7 gaining an order-selection step it doesn't need today.

### D2 — Order status is derived, not stored as independent truth

There's no `orders.status` column with its own state machine. Order status is computed from the aggregate of `order_items.fulfillment_status`: all `PENDING` → order is `PENDING`; some `SHIPPED`, some not → `PARTIALLY_FULFILLED`; all `DELIVERED` → `FULFILLED`. Storing it independently invites the two systems (item-level facts and order-level summary) to drift apart. Compute it on read, or maintain it as a materialized/denormalized column refreshed by a trigger on `order_items` — never as something written directly by application code.

### D3 — Snapshot pricing, always

`order_items.listing_snapshot` captures title, price, description, and category at the moment of purchase. This is what the buyer paid for and what a dispute (M3) evaluates against — not whatever the listing says today.

---

## 3. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS orders;
SET search_path TO orders, public;
```

### 3.1 Enumerations

```sql
CREATE TYPE item_fulfillment_status AS ENUM (
  'PENDING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'RETURNED', 'CANCELLED'
);
```

### 3.2 Orders and items

```sql
CREATE TABLE orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id        uuid NOT NULL,   -- soft ref to trade.trades(id) — D1
  buyer_user_id   uuid NOT NULL,
  seller_user_id  uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX orders_trade_unique ON orders (trade_id);
CREATE INDEX orders_buyer_idx ON orders (buyer_user_id);
CREATE INDEX orders_seller_idx ON orders (seller_user_id);

CREATE TABLE order_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  listing_id          uuid,   -- soft ref to M5's listing, for traceability only
  listing_snapshot    jsonb NOT NULL,   -- title, price_minor, description, category — D3
  quantity            integer NOT NULL DEFAULT 1,
  unit_price_minor    bigint NOT NULL,
  fulfillment_status  item_fulfillment_status NOT NULL DEFAULT 'PENDING',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT order_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT order_items_price_positive CHECK (unit_price_minor > 0)
);

CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_status_idx ON order_items (fulfillment_status);
```

### 3.3 Shipment association (M2 owns the shipment; this is the join)

```sql
CREATE TABLE order_item_shipments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id   uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  shipment_id     uuid NOT NULL,   -- soft ref to logistics.shipments(id), M2
  linked_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_item_shipments_item_idx ON order_item_shipments (order_item_id);
CREATE INDEX order_item_shipments_shipment_idx ON order_item_shipments (shipment_id);
```

### 3.4 Status change log (append-only, same pattern as prior modules)

```sql
CREATE TABLE order_item_status_changes (
  id              bigserial PRIMARY KEY,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  order_item_id   uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  from_status     item_fulfillment_status,
  to_status       item_fulfillment_status NOT NULL,
  source          text NOT NULL   -- 'SELLER'|'M2_SHIPMENT_EVENT'|'SYSTEM'
);

CREATE INDEX order_item_status_changes_item_idx
  ON order_item_status_changes (order_item_id, occurred_at);
```

---

## 4. Order-level status derivation (D2)

```sql
-- Example view, not a stored column — computed from item-level truth.
CREATE VIEW order_status AS
SELECT
  o.id AS order_id,
  CASE
    WHEN bool_and(oi.fulfillment_status = 'DELIVERED') THEN 'FULFILLED'
    WHEN bool_or(oi.fulfillment_status IN ('SHIPPED', 'DELIVERED'))
     AND bool_or(oi.fulfillment_status = 'PENDING') THEN 'PARTIALLY_FULFILLED'
    WHEN bool_and(oi.fulfillment_status = 'CANCELLED') THEN 'CANCELLED'
    ELSE 'PENDING'
  END AS derived_status
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id;
```

For read-heavy paths (an order list screen rendering hundreds of rows), materialize this instead of computing it live — a trigger on `order_items` refreshing a denormalized `orders.cached_status` column is the pragmatic version once this becomes a real query-volume concern. Not needed at launch.

---

## 5. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `order.created` | orderId, tradeId | Notifications |
| `order.item_shipped` | orderItemId, shipmentId | M7 (feeds §6's delivery-signal logic), Notifications |
| `order.item_delivered` | orderItemId | M7, Reputation |
| `order.fully_fulfilled` | orderId | M7, Notifications |
| `order.item_cancelled` | orderItemId, reason | Notifications, Reputation |

`order.item_shipped`/`order.item_delivered` are what M7 §6's delivery-confirmation trust weighting actually listens to — M9 sits between M2 (raw shipment events) and M7 (the state machine that cares about delivery), translating "this specific shipment hit this specific milestone" into "this order item's fulfillment status changed."

---

## 6. API surface

```
GET    /orders/:id
GET    /orders/:id/items
POST   /orders/:id/items/:itemId/mark-ready-to-ship   seller action

# Internal, called by M2 on shipment status events
POST   /internal/orders/items/:itemId/fulfillment-status
```

---

## 7. What I would specify next

Continuing M1 §20's list: **Tickets (M10)**, then **Reputation (M12)** and **Risk & Fraud (M13)**.
