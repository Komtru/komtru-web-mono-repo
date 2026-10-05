# Kumtru — Module 18: Referral & Growth

**Implementation specification**
Version 0.1 · 20 August 2026 · Status: Draft for engineering review

---

## 0. How to read this document

This module follows the same event-only execution boundary Disputes (M3) established for money it doesn't directly control: M3 decides an outcome and emits an event, M8 is the only module that actually moves money. Referral & Growth decides that a reward has been earned and emits an event; M8 is still the only module that credits anything. Nothing here writes to `ledger_entries`, the same way nothing in M3 does.

The other thing worth carrying in from M13 (Risk & Fraud): referral programs are a well-known abuse surface — self-referral, fake accounts, coordinated reward farming. This module doesn't build its own fraud detection; it treats a `risk.restriction_applied` event against either party in a referral pair as a reason to void the reward, deferring the actual detection work to the module that already owns it.

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Referral codes | Per-user, shareable, trackable |
| Referral tracking | Referrer → referee linkage, qualification status |
| Reward requests | Emitting the "this referral earned a reward" signal — never crediting it directly |
| Promo/discount codes | Campaign-level codes, separate object from personal referral codes |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Payment & Ledger (M8) | Actually crediting a reward or applying a discount to a trade total — M18 requests, M8 executes |
| Risk & Fraud (M13) | Detecting referral abuse patterns — M18 reacts to M13's restrictions, doesn't detect fraud itself |
| Identity & Access (M1) | Account creation itself — M18 reads `identity.user_registered` to attribute a referral, doesn't own signup |

> **Boundary note, same shape as M3→M8:** a referral reward and a dispute resolution are structurally the same kind of object — a decision that money should move, made by a module that doesn't touch the ledger. Keeping that boundary consistent across the whole system (M3, M8's own payout requests, and now M18) means anyone who's read one money-adjacent module already understands how every other one hands off to M8.

---

## 2. Core design decisions

### D1 — A reward is requested via an event, never applied directly

`referral_reward_log` records a reward request (`referral.reward_requested`); M8 is the only system that turns that into an actual credit. M18 has no code path that writes to `ledger_entries` or any payout table.

### D2 — A referral only qualifies on a real trade outcome, not on signup

`referrals.status` moves from `PENDING` to `QUALIFIED` only when the referee reaches a defined qualifying action — v1's default is the referee's first `trade.settled` (M7) — never simply on account creation. This is the most basic anti-abuse measure available before any real fraud-detection logic exists: a reward tied to real trade volume is inherently harder to farm than one tied to a free signup.

### D3 — Personal referral codes and campaign promo codes are separate objects

`referral_codes` is per-user, generated automatically or on request, and always maps back to exactly one referrer. `promo_codes` belongs to a marketing campaign, has no single owning user, and carries its own redemption limits and expiry — conflating the two would mean a marketing discount campaign accidentally attributing referral credit to whoever's code format matched, which is a real category of bug in referral systems that reuse one code table for both purposes.

### D4 — Reward amounts and qualifying-action definitions are configuration, not code

Per Configuration (M17)'s D1 pattern, `platform_settings` under the `referral` namespace holds the current reward amount and which event counts as "qualified." Growth/marketing needs to run different reward amounts across campaigns without an engineering deploy for every change.

---

## 3. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS growth;
SET search_path TO growth, public;
```

### 3.1 Enumerations

```sql
CREATE TYPE referral_status AS ENUM ('PENDING', 'QUALIFIED', 'REWARDED', 'VOID');
CREATE TYPE discount_type AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');
```

### 3.2 Referral codes and referrals

```sql
CREATE TABLE referral_codes (
  user_id     uuid PRIMARY KEY,   -- soft ref to identity.users(id)
  code        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE referrals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id  uuid NOT NULL,
  referee_user_id   uuid NOT NULL,
  referral_code     text NOT NULL,
  status            referral_status NOT NULL DEFAULT 'PENDING',
  qualifying_event  text,   -- e.g. 'trade.settled', set once QUALIFIED
  qualified_at      timestamptz,
  voided_reason     text,   -- set if status = VOID, e.g. 'RISK_RESTRICTION' (D2 tie-in)
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT referrals_not_self CHECK (referrer_user_id <> referee_user_id)
);

CREATE UNIQUE INDEX referrals_one_per_referee ON referrals (referee_user_id);
CREATE INDEX referrals_referrer_idx ON referrals (referrer_user_id, status);
```

### 3.3 Reward log (append-only, D1)

```sql
CREATE TABLE referral_reward_log (
  id              bigserial PRIMARY KEY,
  referral_id     uuid NOT NULL REFERENCES referrals(id),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  amount_minor    bigint NOT NULL,
  status          text NOT NULL DEFAULT 'REQUESTED'   -- 'REQUESTED'|'CREDITED'|'VOIDED'
);

CREATE INDEX referral_reward_log_referral_idx ON referral_reward_log (referral_id);
```

### 3.4 Promo codes (D3)

```sql
CREATE TABLE promo_codes (
  code              text PRIMARY KEY,
  description       text NOT NULL,
  discount_type     discount_type NOT NULL,
  discount_value    numeric NOT NULL,   -- percentage (0-100) or kobo, per discount_type
  max_redemptions   integer,   -- null = unlimited
  redemption_count  integer NOT NULL DEFAULT 0,
  expires_at        timestamptz,
  active            boolean NOT NULL DEFAULT true
);

CREATE TABLE promo_redemptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code      text NOT NULL REFERENCES promo_codes(code),
  user_id         uuid NOT NULL,
  trade_id        uuid,   -- soft ref to trade.trades(id)
  redeemed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX promo_redemptions_code_idx ON promo_redemptions (promo_code);
CREATE INDEX promo_redemptions_user_idx ON promo_redemptions (user_id);
```

---

## 4. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `referral.created` | referralId, referrerUserId, refereeUserId | Notifications |
| `referral.qualified` | referralId, qualifyingEvent | Notifications, Reputation (M12, informational) |
| `referral.reward_requested` | referralId, amountMinor | Payment & Ledger (M8) — executes the credit |
| `referral.voided` | referralId, reason | Notifications, Audit (M15) |
| `promo.redeemed` | promoCode, userId, tradeId | Payment & Ledger (M8) — applies discount |

## 5. Events consumed

| Event (from) | Effect |
|---|---|
| `identity.user_registered` (M1) | Attributes a new account to a referral code if one was used at signup — creates `referrals` row, `PENDING` |
| `trade.settled` (M7) | Checks whether this is the referee's qualifying trade — D2 |
| `risk.restriction_applied` (M13) | Voids any `PENDING`/`QUALIFIED` referral involving the restricted user — D2's abuse-response tie-in |

---

## 6. API surface

```
POST   /referrals/my-code                  generate/fetch the caller's referral code
GET    /referrals/mine                     list of referrals the caller made, with status

# Internal, called during checkout (M7/M8 flow)
POST   /internal/promo-codes/:code/validate
POST   /internal/promo-codes/:code/redeem

# Admin
POST   /admin/promo-codes
PUT    /admin/promo-codes/:code
```

---

## 7. What I would specify next

Continuing M1 §20's list: **Search (M19)**, then **File & Evidence Management (M20)** — the last module, and the one nearly every prior module has referenced as owning file storage without yet defining it.
