# Kumtru — Module 19: Search

**Implementation specification**
Version 0.1 · 20 August 2026 · Status: Draft for engineering review

---

## 0. How to read this document

Merchant Management (M5) already named this module as the consumer of its `listing.created`/`listing.updated`/`listing.status_changed` events. Reputation (M12) drew a boundary note specifically anticipating this module's existence: "product surfaces — search ranking, buyer-facing trust badges, seller limits — should read both [identity confidence and reputation] numbers and combine them deliberately, never substitute one for the other." This module is where that combination actually happens.

The same caution Reporting & Analytics (M16 §2 D1) applied to aggregation applies here to indexing: **search is a derived, rebuildable read model, never a system of record.** If `search_documents` were truncated and rebuilt entirely from M5's listings and the trust signals named below, nothing would be permanently lost — only temporarily unsearchable until reindexing catches up.

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Search index | A denormalized, queryable document per listing |
| Query serving | Full-text search plus structured filters (category, price range) |
| Ranking | Relevance blended with trust signals (verification level, reputation) |
| Index maintenance | Near-real-time updates driven by source-module events |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Merchant Management (M5) | The actual listing record — M19 indexes a copy, M5 is the source of truth |
| Trust & Verification (M6) | Computing verification level — M19 reads it as a ranking input |
| Reputation (M12) | Computing the reputation score — M19 reads it as a ranking input |
| Reporting & Analytics (M16) | Search-behavior trend analysis — M19 can emit query events for M16 to aggregate, doesn't analyze them itself |

> **Boundary note:** M12 §1 already stated the principle this module has to implement: identity confidence and reputation are two different axes, and ranking has to read both deliberately rather than collapsing them into one score borrowed from whichever module computed something numeric first. M19's ranking formula (§4) keeps them as separate weighted inputs for exactly that reason.

---

## 2. Core design decisions

### D1 — The index is derived and fully rebuildable, never authoritative

`search_documents` has no data that doesn't already exist somewhere else — title, price, and category are copied from M5; trust signals are copied from M6/M12. A full reindex job (§5) can always reconstruct the entire table from source modules. This is what makes an imperfect or stale index a performance problem, never a data-loss problem.

### D2 — Index updates are near-real-time, event-driven — not a scheduled batch

Unlike M16's analytics aggregation (which tolerates being hours stale, M16 §2 D2), a listing's search visibility needs to track its actual status closely — a seller pausing a listing should stop it from appearing in results within seconds, not at the next scheduled run. `listing.status_changed` and related events are consumed by a BullMQ job per event, not a cron batch.

### D3 — Ranking blends relevance with trust signals, and neither one alone decides visibility

A listing's rank is a function of text-match relevance *and* the seller's verification level (M6) and reputation score (M12), combined with named weights (§4) — never sorted purely by recency or purely by trust score. A highly relevant, lower-trust listing still appears, just not necessarily first; a highly-trusted seller's marginally-relevant listing doesn't crowd out better matches. Both M6's identity confidence and M12's behavioral reputation contribute as separate terms, per the boundary M12 §1 drew.

### D4 — PostgreSQL full-text search at launch, not a dedicated search service

Consistent with Module 0's MVP cost posture (no paid service where a built-in option covers the need — the same reasoning that dropped AWS KMS/Secrets Manager in favor of env-var encryption), v1 uses PostgreSQL's native `tsvector`/GIN-index full-text search against `search_documents`, not a separate Elasticsearch/OpenSearch/Algolia deployment. The upgrade trigger, named explicitly rather than left implicit: catalog size growing past what a single Postgres instance's FTS comfortably serves at acceptable query latency, or a product requirement (typo-tolerant fuzzy search, faceted aggregation at scale) that Postgres FTS genuinely can't do well — not a default assumption that a dedicated search engine will eventually be needed.

---

## 3. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS search;
SET search_path TO search, public;
```

### 3.1 Search documents (D1)

```sql
CREATE TABLE search_documents (
  listing_id          uuid PRIMARY KEY,   -- soft ref to merchant.listings(id)
  seller_user_id      uuid NOT NULL,
  title               text NOT NULL,
  description         text NOT NULL,
  category            text NOT NULL,
  price_minor         bigint NOT NULL,
  is_searchable       boolean NOT NULL DEFAULT false,   -- false unless listing status = ACTIVE
  verification_level_cache integer NOT NULL DEFAULT 0,   -- copied from M6
  reputation_score_cache   numeric(5,2) NOT NULL DEFAULT 50,   -- copied from M12
  search_vector       tsvector,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX search_documents_vector_idx ON search_documents USING GIN (search_vector);
CREATE INDEX search_documents_category_idx ON search_documents (category) WHERE is_searchable;
CREATE INDEX search_documents_price_idx ON search_documents (price_minor) WHERE is_searchable;

CREATE OR REPLACE FUNCTION search.refresh_search_vector()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER search_documents_vector_update
  BEFORE INSERT OR UPDATE ON search_documents
  FOR EACH ROW EXECUTE FUNCTION search.refresh_search_vector();
```

### 3.2 Query log (optional, feeds M16)

```sql
CREATE TABLE search_query_log (
  id            bigserial PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  user_id       uuid,   -- null for unauthenticated search
  query_text    text,
  filters       jsonb NOT NULL DEFAULT '{}',
  result_count  integer NOT NULL
);

CREATE INDEX search_query_log_occurred_idx ON search_query_log (occurred_at DESC);
```

---

## 4. Ranking (v1, illustrative)

```
rank_score = (0.6 * text_relevance)          -- ts_rank against search_vector
           + (0.25 * normalized_reputation)   -- reputation_score_cache / 100
           + (0.15 * normalized_verification) -- verification_level_cache / max_level

Listings below a minimum relevance threshold are excluded outright; among
results that clear the threshold, trust signals influence order, never
inclusion. This mirrors M12 §4's own framing of its score formula: v1
coefficients are a starting point, tunable via Configuration (M17) once
real query data exists to validate against.
```

---

## 5. Index maintenance flow

```
listing.created / listing.updated / listing.status_changed (M5)
        │
        ▼
  BullMQ job: upsert search_documents row
        │
        ├─ status = ACTIVE  → is_searchable = true
        └─ any other status → is_searchable = false (D2: near-real-time)

verification.level_attained / verification.level_revoked (M6)
        │
        ▼
  BullMQ job: update verification_level_cache for that seller's documents

reputation.score_changed (M12)
        │
        ▼
  BullMQ job: update reputation_score_cache for that seller's documents

Nightly: full reindex job cross-checks search_documents against M5's
listings table and reconciles any drift — D1's rebuildability as an
active consistency check, not just a theoretical property.
```

---

## 6. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `search.query_logged` | queryText, filters, resultCount | Reporting & Analytics (M16) |
| `search.reindex_completed` | documentCount, driftCorrected | Ops |

## 7. Events consumed

| Event (from) | Effect |
|---|---|
| `listing.created` / `listing.updated` / `listing.status_changed` (M5) | Upsert/update `search_documents` — D2 |
| `verification.level_attained` / `verification.level_revoked` (M6) | Refresh `verification_level_cache` |
| `reputation.score_changed` (M12) | Refresh `reputation_score_cache` |

---

## 8. API surface

```
GET    /search/listings?q=&category=&minPrice=&maxPrice=&sort=relevance|price_asc|price_desc
```

---

## 9. What I would specify next

Continuing M1 §20's list: **File & Evidence Management (M20)** — the last module in the full set, and the one nearly every prior module has referenced as owning file storage (proof-of-delivery photos in M2, dispute evidence in M3, listing images in M5, verification documents in M6) without yet defining it.
