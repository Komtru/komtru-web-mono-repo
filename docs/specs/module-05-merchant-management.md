# Kumtru — Module 5: Merchant Management

**Implementation specification**
Version 0.1 · 20 August 2026 · Status: Draft for engineering review

---

## 0. How to read this document

Module 9 (Orders) already referenced this module by name — its `order_items.listing_id` is a soft ref waiting on this schema, and its D3 (snapshot pricing) explicitly depends on this module's listings being *mutable*, live records that M9 must never read from directly once a purchase happens. That boundary is the one to hold onto reading this document: M5 owns the current, editable truth of what a seller is offering; M9 owns a frozen copy of what a buyer actually agreed to. This module never reaches backward into a past order to "correct" what a snapshot recorded.

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Merchant profile | Business name, type (individual/registered business), category, storefront |
| Listings | The product/service catalog — title, price, description, images, status |
| Inventory | Optional stock tracking, per-listing |
| Storefront | A seller's public-facing page, listing list, profile summary |
| Listing lifecycle | Draft → active → paused/sold-out → removed |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Trust & Verification (M6) | Whether a seller is identity/business-verified — M5 reads the verification level, doesn't compute it |
| Orders (M9) | The purchased-item snapshot — M5 never edits a past order's copy of a listing |
| File & Evidence Management (M20) | Actual image storage — M5 stores references |
| Risk & Fraud (M13) | Seller restrictions and holds — M5 enforces what M13 decides, doesn't decide it itself |
| Search (M19) | Discovery/ranking — M5 emits the events search indexes from |

> **Boundary note:** a merchant profile is not the same object as an identity (M1) or a verification record (M6) — it's the *storefront* layer on top of both. A user can have a fully verified identity and no merchant profile at all (a buyer-only account); a merchant profile always points back to exactly one identity, never the reverse.

---

## 2. Core design decisions

### D1 — Listing creation requires the seller's verification level to meet a category threshold

Not every category needs the same bar — a low-value casual listing might only require M6's baseline account verification, while higher-value or regulated categories require business verification. M5 checks `verification_level_changes` (M6) at listing-creation time; it doesn't re-implement KYC logic, and it doesn't cache a "verified" boolean that could go stale after a later `verification.level_revoked` — see D4.

### D2 — Listings are mutable; orders freeze a copy at the moment of purchase

Directly enforces M9's D3. Editing a live listing's price or description never rewrites history — every already-placed order keeps exactly what the buyer agreed to. This module has no "retroactively apply new price" feature, on purpose.

### D3 — Stock tracking is optional per listing

`listings.stock_quantity` is nullable — `NULL` means untracked (services, made-to-order goods, or sellers who don't want the overhead), a non-null integer means the platform enforces availability. Forcing every seller to maintain exact inventory counts is a barrier to listing something at all; the schema accommodates both without two separate listing types.

### D4 — A risk or verification change cascades to listing visibility automatically

When M13 applies a `FULL_FREEZE` restriction, or M6 emits `verification.level_revoked` below a listing's category threshold, M5 auto-transitions the seller's active listings to `PAUSED` (not `REMOVED` — reversible once the underlying issue clears) rather than requiring a human to remember to hide them. This is the same instinct as M11's dead-letter-triggers-a-ticket pattern: don't let an important state change depend on someone noticing.

---

## 3. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS merchant;
SET search_path TO merchant, public;
```

### 3.1 Enumerations

```sql
CREATE TYPE business_type AS ENUM ('INDIVIDUAL', 'REGISTERED_BUSINESS');

CREATE TYPE listing_status AS ENUM (
  'DRAFT', 'ACTIVE', 'PAUSED', 'SOLD_OUT', 'REMOVED'
);
```

### 3.2 Merchant profiles

```sql
CREATE TABLE merchant_profiles (
  user_id           uuid PRIMARY KEY,   -- soft ref to identity.users(id)
  business_name     text NOT NULL,
  business_type     business_type NOT NULL,
  storefront_slug   text NOT NULL UNIQUE,
  bio               text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
```

### 3.3 Listings

```sql
CREATE TABLE listings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_user_id    uuid NOT NULL,
  title             text NOT NULL,
  description       text NOT NULL,
  category          text NOT NULL,
  price_minor       bigint NOT NULL,   -- kobo, per M7/M8 convention
  currency          text NOT NULL DEFAULT 'NGN',
  status            listing_status NOT NULL DEFAULT 'DRAFT',
  stock_quantity    integer,   -- D3: null = untracked
  paused_reason     text,   -- set when D4 auto-pauses a listing
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT listings_price_positive CHECK (price_minor > 0),
  CONSTRAINT listings_stock_nonnegative CHECK (stock_quantity IS NULL OR stock_quantity >= 0)
);

CREATE INDEX listings_seller_idx ON listings (seller_user_id, status);
CREATE INDEX listings_category_active_idx ON listings (category) WHERE status = 'ACTIVE';
```

### 3.4 Images (references only — M20 owns storage)

```sql
CREATE TABLE listing_images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  file_ref_id   uuid NOT NULL,   -- soft ref to M20 file record
  sort_order    integer NOT NULL DEFAULT 0
);

CREATE INDEX listing_images_listing_idx ON listing_images (listing_id, sort_order);
```

### 3.5 Status change log (append-only, same pattern as prior modules)

```sql
CREATE TABLE listing_status_changes (
  id            bigserial PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  listing_id    uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  from_status   listing_status,
  to_status     listing_status NOT NULL,
  source        text NOT NULL   -- 'SELLER'|'SYSTEM_RISK_CASCADE'|'SYSTEM_VERIFICATION_CASCADE'
);

CREATE INDEX listing_status_changes_listing_idx
  ON listing_status_changes (listing_id, occurred_at);
```

---

## 4. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `listing.created` | listingId, sellerUserId, category | Search (M19) |
| `listing.updated` | listingId, fields | Search |
| `listing.status_changed` | listingId, fromStatus, toStatus, source | Search, Notifications |
| `merchant.profile_created` | userId | Notifications |

## 5. Events consumed

| Event (from) | Effect |
|---|---|
| `risk.restriction_applied` type `FULL_FREEZE` (M13) | Auto-pause all `ACTIVE` listings for that seller — D4 |
| `risk.restriction_lifted` (M13) | Listings paused by the cascade become eligible for the seller to reactivate (not auto-reactivated — a human glance is cheap insurance here) |
| `verification.level_revoked` (M6) | Auto-pause listings whose category threshold (D1) is no longer met |
| `order.item_delivered` (M9) | Decrement `stock_quantity` if tracked and not already decremented at order-placement time (exact timing — reserve-at-order vs. decrement-at-delivery — is an implementation choice left open here, flagged for the engineering team) |

---

## 6. API surface

```
POST   /merchant/profile
GET    /merchant/profile/:slug              public storefront view
POST   /listings
PUT    /listings/:id
POST   /listings/:id/publish                DRAFT → ACTIVE, checks D1
POST   /listings/:id/pause
POST   /listings/:id/remove
GET    /listings/:id
GET    /storefront/:slug/listings
```

---

## 7. What I would specify next

Continuing M1 §20's list: **Logistics (M2)**, then **Disputes (M3, full depth)** — completing the marketplace-mechanics trio the seed blueprint grouped together.
