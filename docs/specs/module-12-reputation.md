# Kumtru — Module 12: Reputation

**Implementation specification**
Version 0.1 · 20 August 2026 · Status: Draft for engineering review

---

## 0. How to read this document

Module 6 (Trust & Verification) already uses the word "trust" for something else entirely: *identity confidence* — is this person who they claim to be, provider-attested, NIN/BVN-anchored. This module is the other half of the word, and the two must never be merged into one number. Reputation is *behavioral*: has this person actually done what they said they'd do, across real trades, over time. A newly-verified user with a level-4 identity badge and zero completed trades has high identity confidence and no reputation yet — both statements are true at once, and the product needs to be able to say both.

Trade Management (M7) is this module's only real data source: every signal here traces back to a completed, cancelled, or disputed trade. This module doesn't watch listings, messages, or logins — that's other modules' business.

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Ratings | Post-trade star rating + comment, buyer↔seller, both directions |
| Reputation score | A computed number per user, derived from trade outcomes |
| Score inputs | Completion rate, dispute rate, dispute-loss rate, rating average, response time (from M7/M8/M10 events) |
| Rating responses | The rated party can post one public response to a rating |
| Reputation history | Append-only log of what changed a user's score and why |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Trust & Verification (M6) | Identity confidence, verification levels — a completely separate axis |
| Trade Management (M7) | The trade outcomes themselves — M12 only reads M7's events |
| Disputes (M3) | The dispute decision — M12 reads the *outcome* (who was found at fault), not the case |
| Administration (M14) | Moderating rating comment text (abuse, profanity) — M12 stores it, M14 polices it |

> **Boundary note, same shape as M6 §1 and M10 §1:** identity confidence answers *"is this really who they say they are?"* Reputation answers *"do they follow through?"* A user can be fully verified and have terrible reputation (verified identity, repeatedly fails to ship), or have a thin verification level and excellent reputation (long trade history, always follows through, just hasn't done the higher KYC tiers). Product surfaces — search ranking, buyer-facing trust badges, seller limits — should read both numbers and combine them deliberately, never substitute one for the other.

---

## 2. Core design decisions

### D1 — The reputation score is computed, never directly writable

No API sets `reputation_profiles.score` directly — not even an admin one. It's recalculated from the underlying counts (§4) whenever a contributing event fires. This mirrors M9's D2 (order status is derived, not stored as independent truth): the moment a number can drift from the facts that produced it, someone eventually trusts the wrong one.

### D2 — One rating per party per trade, both directions independent

A buyer rates the seller and the seller rates the buyer — two separate `ratings` rows against the same `trade_id`, neither blocked by the other existing. Ratings are locked to `COMPLETED`/`SETTLED` trades per M7's state machine (rating an in-flight trade doesn't mean anything yet), with a submission window (default 14 days post-settlement) after which the opportunity closes rather than staying open indefinitely.

### D3 — Dispute involvement affects score only on resolution, never on filing

Being disputed is not evidence of wrongdoing — plenty of legitimate disputes exist because of genuine misunderstandings, and a seller shouldn't take a reputation hit the moment a buyer opens a case. Only `dispute.resolved` (from M3, not yet specced) with a fault attribution moves the score. This is a deliberate presumption-of-good-faith design choice, not an oversight.

### D4 — Reputation is public-readable but the derivation log is not

A user's score, rating average, and public rating comments are visible to anyone evaluating them as a counterparty. The `reputation_score_events` derivation log (§3.4) — the raw event-by-event history of what moved the number — is an internal/admin view, same posture M10 takes with internal notes vs. customer-visible messages.

---

## 3. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS reputation;
SET search_path TO reputation, public;
```

### 3.1 Reputation profile (one row per user)

```sql
CREATE TABLE reputation_profiles (
  user_id                   uuid PRIMARY KEY,   -- soft ref to identity.users(id)
  completed_trades          integer NOT NULL DEFAULT 0,
  cancelled_trades          integer NOT NULL DEFAULT 0,
  disputes_involved         integer NOT NULL DEFAULT 0,
  disputes_at_fault         integer NOT NULL DEFAULT 0,
  rating_count              integer NOT NULL DEFAULT 0,
  rating_sum                integer NOT NULL DEFAULT 0,   -- sum of stars, avg = sum/count
  score                     numeric(5,2) NOT NULL DEFAULT 0,   -- D1: computed, 0-100
  last_recalculated_at      timestamptz NOT NULL DEFAULT now()
);
```

### 3.2 Ratings

```sql
CREATE TABLE ratings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id          uuid NOT NULL,   -- soft ref to trade.trades(id)
  rater_user_id     uuid NOT NULL,
  ratee_user_id     uuid NOT NULL,
  stars             smallint NOT NULL,
  comment           text,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ratings_stars_range CHECK (stars BETWEEN 1 AND 5),
  CONSTRAINT ratings_not_self CHECK (rater_user_id <> ratee_user_id)
);

CREATE UNIQUE INDEX ratings_one_per_party_per_trade
  ON ratings (trade_id, rater_user_id);
CREATE INDEX ratings_ratee_idx ON ratings (ratee_user_id, created_at DESC);
```

### 3.3 Rating responses (D-none, simple 1:1)

```sql
CREATE TABLE rating_responses (
  rating_id     uuid PRIMARY KEY REFERENCES ratings(id) ON DELETE CASCADE,
  responder_id  uuid NOT NULL,   -- must equal ratings.ratee_user_id, enforced at API layer
  body          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

### 3.4 Score derivation log (append-only, D4)

```sql
CREATE TABLE reputation_score_events (
  id            bigserial PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  user_id       uuid NOT NULL,
  event_name    text NOT NULL,   -- e.g. 'trade.settled', 'dispute.resolved'
  delta_detail  jsonb NOT NULL,   -- what counter moved, old/new score
  score_before  numeric(5,2) NOT NULL,
  score_after   numeric(5,2) NOT NULL
);

CREATE INDEX reputation_score_events_user_idx
  ON reputation_score_events (user_id, occurred_at DESC);
```

---

## 4. Score computation (v1, deliberately simple)

```
score = clamp(0, 100,
    50                          -- neutral starting point
  + (completion_rate - 0.90) * 100
  + (avg_rating - 3.0) * 10
  - (dispute_fault_rate) * 40
)

-- completion_rate     = completed / (completed + cancelled)
-- avg_rating           = rating_sum / rating_count, default 3.0 if none
-- dispute_fault_rate   = disputes_at_fault / completed_trades
```

This is a v1 formula, not a final one — the coefficients are placeholders meant to be tuned once real trade volume exists to validate against. What matters at the schema level is that every input is one of the counters in §3.1, each counter's source event is traceable in §3.4, and the formula lives in one place (application code, not spread across triggers) so it can be revised without a migration. A new user with no trade history starts at the neutral midpoint (50) rather than 0 — zero would visually read as "bad," which isn't the same claim as "unproven."

---

## 5. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `reputation.rating_submitted` | ratingId, tradeId, raterUserId, rateeUserId, stars | Notifications |
| `reputation.score_changed` | userId, oldScore, newScore, reason | Notifications (milestone crossings only), Merchant Management (M5, seller limits) |
| `reputation.rating_response_posted` | ratingId, responderId | Notifications |

## 6. Events consumed

| Event (from) | Effect |
|---|---|
| `trade.settled` (M7) | `completed_trades++`, recalculate |
| `trade.cancelled` (M7) | `cancelled_trades++`, recalculate |
| `dispute.opened` (M3) | `disputes_involved++` only — D3, no score effect |
| `dispute.resolved` (M3) | if fault attributed: `disputes_at_fault++`, recalculate |

---

## 7. API surface

```
GET    /users/:id/reputation              public score + rating average + recent ratings
GET    /users/:id/ratings
POST   /trades/:id/rate             submit a rating (D2 window enforced)
POST   /ratings/:id/respond               ratee only

# Internal / admin
GET    /admin/users/:id/reputation/history   full reputation_score_events log (D4)
```

---

## 8. What I would specify next

Continuing M1 §20's list: **Risk & Fraud (M13)** — the natural next module, since fraud signals often need to read this module's dispute-fault and cancellation rates as risk inputs, then **Merchant Management (M5)**.
