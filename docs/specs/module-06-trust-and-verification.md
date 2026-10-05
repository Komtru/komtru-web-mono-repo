# Kumtru — Module 6: Trust & Verification

**Implementation specification**
Version 0.1 · 20 August 2026 · Status: Draft for engineering review

---

## 0. How to read this document

This is the second Kumtru module spec, and the one Identity (M1) is already partially blocked on — `users.verification_level` exists in M1's schema today, but M1 explicitly does not compute levels 2 and above. This document is that computation.

Three rules govern everything below, mirroring how M1 was scoped:

1. **This module answers "who is this person in the real world?"** — never "is this the person who owns this account?" (that's M1). If you find yourself writing session or password logic here, it belongs in M1 instead.
2. **Verification levels are provider-attested facts, not self-declared claims.** A user cannot type their NIN into a form and be marked verified. Every level 2+ grant traces to a specific provider response, on a specific date, that a specific admin or automated rule accepted.
3. **This module never stores raw documents.** KYC images, liveness selfies, and CAC certificates live in File & Evidence Management (M20) object storage (the `kyc-documents` S3 bucket already provisioned in Module 0 §2). This schema stores references, hashes, and outcomes — not files.

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| NIN verification | National Identity Number lookup and match against a licensed provider |
| BVN verification | Bank Verification Number lookup and match |
| Liveness / facial match | Selfie-to-ID biometric comparison |
| CAC verification | Corporate Affairs Commission business registration check |
| Bank account name-match | Confirming an account holder's name matches the verified identity (not storing the account itself) |
| Address verification | Lightweight proof-of-address for higher tiers |
| Document verification | ID card / passport / CAC certificate authenticity checks via provider |
| Social proof | Instagram/X handle ownership claims, verified out-of-band (not login — see M1 §7.2) |
| Verification level state machine | Levels 0–4, specifically M6's ownership of levels 2–4 |
| Duplicate-identity detection | One NIN/BVN backing more than one active account |
| Manual review queue | `KYC_ANALYST` workflow for provider-ambiguous or flagged cases |
| Provider adapter layer | Swappable third-party KYC provider integration |
| Verification audit log | Append-only record of every verification decision |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Identity & Access (M1) | Authentication, sessions, levels 0–1 (email/phone), `users.verification_level` storage itself |
| Reputation (M12) | Completion rate, dispute rate, ratings, cancellation rate — *behavioral* trust, not identity confidence |
| Payment & Ledger (M8) | Bank account storage, payout destination selection, settlement |
| Merchant Management (M5) | Which seller tier (individual/professional/business/enterprise) a user operates as — M6 verifies the *facts* (CAC number is real, bank name matches); M5 decides what tier those facts unlock |
| File & Evidence Management (M20) | Actual document/image storage, retention enforcement |
| Risk & Fraud (M13) | Risk scoring. M6 emits duplicate-identity and mismatch signals; it does not score overall account risk |
| Tickets (M10) | Support cases arising from failed/stuck verification (auto-opened per §9) |

> **Boundary note, restated from M1 because it's the one people get wrong:** M6 owns *identity confidence* — is this a real, unique, verified human or business. M12 owns *behavioral trust* — has this account done right by counterparties. A user can be `IDENTITY_VERIFIED` (M6, level 2) with a terrible completion rate (M12). Never conflate the two into one "trust score."

---

## 2. Why this is the second module, not the fifth

Per M1 §20, this was the author's own next-in-line recommendation: "it gates seller capability, and the identity schema already references `verification_level`. Blocked on nothing." Nothing in this document contradicts that — M6 depends only on M1 (a user must exist and reach `CONTACT_VERIFIED` before attempting identity verification) and on M20's storage buckets, which Module 0 already provisioned.

One thing *does* change as a result of building this module, and it's worth flagging immediately rather than burying it: **Module 0 §2a's env-var encryption decision was explicitly justified by "no live NIN/BVN handling yet."** That condition stops being true the moment this module ships. See §12.

---

## 3. Core design decisions

### D1 — Never store a raw NIN or BVN at rest

The provider call needs the raw number to do its job, but Kumtru's database never should. What's persisted:

- A **masked display value** (`***-***-1234` style) for UI and support use.
- An **HMAC-SHA256 hash** (keyed, not a bare SHA-256) of the normalised number, for duplicate-detection uniqueness (§7) — a hash alone, keyed with a secret not derivable from the hash itself, so the table isn't a rainbow-table target.
- The **provider's own reference ID** for that verification call, so a re-check or dispute can be traced back to the provider's system without Kumtru re-holding the number.
- The **raw number itself, briefly, in transit only** — passed to the provider adapter, never logged, never written to a table, garbage-collected after the call returns.

If a future audit needs the actual NIN (e.g. a compliance request), that's retrieved from the provider's own records via the stored reference ID, not from Kumtru's database. This is a stronger posture than most Nigerian platforms take, and it's cheap: it costs nothing to *not* store something.

### D2 — One verified NIN or BVN, one active account

This is the hard problem this module exists to solve, and it gets the same weight M1 gave username confusables. See §7 in full — a duplicate NIN across two "different" sellers is exactly how a suspended fraudster comes back under a new handle.

### D3 — Provider adapter architecture, not a hard-coded vendor

Per the research behind this spec (see Sources): NIMC does not offer direct API access to arbitrary businesses — access is gated through NIMC's Verification Service and its list of licensed/accredited partners, and NIMC tightened this further after 2024 data-breach incidents rather than opening it up. NIBSS's BVN/NIN validation service (the Financial Authentication Service / BVN SDK / NVS) is likewise reached through the NIBSS Developer Portal under a commercial relationship, not self-serve public access. **Practically, "build vs. buy" barely exists as a question here — direct government-registry integration isn't available to a platform at Kumtru's stage regardless of preference.** The real decision is *which* licensed reseller, and that decision should not be load-bearing in the schema. Every provider call goes through a `KycProviderAdapter` interface (`verifyNin`, `verifyBvn`, `checkLiveness`, `verifyBusiness`, `verifyBankAccountName`) with one implementation per vendor, so switching providers — likely, given how young and price-competitive this vendor space still is — is a config change, not a rewrite.

### D4 — Verification is asynchronous by default

Some provider checks return synchronously; liveness and document-authenticity checks commonly don't (they queue for a human or secondary-model review on the provider's side). Every verification attempt is therefore modeled as a request with a lifecycle, not a single request/response call — following the EventEmitter-for-fan-out / BullMQ-for-durable-work split established in Module 0 §4: the initial submission fires an in-process event, but the actual provider call and webhook wait are BullMQ jobs, so a process restart mid-verification doesn't strand a user in limbo.

### D5 — Documents live in M20, not here

`verification_documents` in this schema stores a `storage_ref` (an M20 file ID) and an outcome, never bytes. Module 0 already provisioned the `kyc-documents` S3 bucket for exactly this. If M20 hasn't been specced yet when this module is implemented, treat its file-reference contract as: `{ file_id, bucket, object_key, checksum, uploaded_at }` — stable enough to build against before M20's full spec exists.

### D6 — Levels 2–4 are cumulative and provider-attested; downgrades are M6's call

Per M1 §2: M6 raises levels via `verification.level_attained` events; M1 never computes them. The inverse also lives here — if a provider later flags a previously-passed check as fraudulent (chargeback-style reversal, document later found forged), M6 emits `verification.level_revoked` and M1 downgrades `users.verification_level` in response. The one exception, per M1's own boundary, is a user removing a verified contact channel — that drops them to level 0 and is M1's call alone, not M6's.

---

## 4. Verification levels — M6's portion

Restating M1 §2's table, with M6's two levels expanded:

| Level | Name | Requirement | Owned by |
|---|---|---|---|
| 0 | `UNVERIFIED` | Registered only | M1 |
| 1 | `CONTACT_VERIFIED` | Email **and** phone verified | M1 |
| 2 | `IDENTITY_VERIFIED` | NIN **or** BVN matched + liveness passed | **M6** |
| 3 | `BUSINESS_VERIFIED` | CAC verified + business bank account name-match | **M6** |
| 4 | `ENHANCED` | Enhanced due diligence — human-reviewed, higher-limit sellers | **M6** |

**Level 2 detail:** NIN *or* BVN, not both — Nigerian users overwhelmingly have one readily to hand but not always both, and requiring both is a completion-rate tax with no proportionate fraud benefit once liveness is in the loop. Liveness is not optional at level 2 regardless of which identifier is used: a matched NIN with no liveness check just proves someone typed a valid-format number, not that they're the person behind it.

**Level 3 detail:** requires level 2 first (a business is operated by a verified human) plus a CAC registration check and a bank-account name-match between the CAC-registered business name (or its verified proprietor) and the settlement account. This is where M6 and M8 touch: M6 verifies the *name match*; M8 owns the actual bank account record and payout routing. M6 never stores the account number beyond what's needed to run the name-match call, and doesn't retain it afterward — M8's `payout_accounts` (or equivalent) is the account of record.

**Level 4 detail:** intentionally left light in this version — "enhanced due diligence" for enterprise merchants is a human process (additional documents, a compliance officer review) more than a schema, and over-specifying it now would guess at requirements that should come from Kumtru's actual compliance function once one exists. The schema below reserves the level and an `enhanced_due_diligence_reviews` table with minimal structure; treat it as a stub, not a gap.

---

## 5. Entity model

```
                                users (M1, id FK only — M6 never owns this row)
                                        │
        ┌───────────────┬───────────────┼───────────────┬────────────────┐
        │               │               │               │                │
┌───────▼──────┐ ┌──────▼───────┐ ┌─────▼──────┐ ┌───────▼───────┐ ┌──────▼───────┐
│ verification_│ │  nin_        │ │  bvn_      │ │  liveness_    │ │  business_   │
│ requests     │ │  verifications│ │ verifications│ │  checks       │ │  verifications│
│ (1:N)        │ │  (1:N)       │ │  (1:N)     │ │  (1:N)         │ │  (1:N)       │
└──────┬───────┘ └──────────────┘ └────────────┘ └────────────────┘ └──────┬───────┘
       │                                                                    │
┌──────▼───────┐ ┌──────────────┐ ┌────────────┐ ┌────────────────┐ ┌──────▼───────┐
│ verification_│ │  bank_account│ │  address_  │ │  social_proof_ │ │  duplicate_  │
│ documents    │ │  name_matches│ │  checks    │ │  claims        │ │  identity_   │
│ (1:N)        │ │  (1:N)       │ │  (1:N)     │ │  (1:N)         │ │  flags       │
└──────────────┘ └──────────────┘ └────────────┘ └────────────────┘ └──────────────┘

Standalone:
  kyc_provider_calls   verification_level_changes (append)   kyc_review_queue
  enhanced_due_diligence_reviews
```

---

## 6. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS trust;
SET search_path TO trust, public;
```

### 6.1 Enumerations

```sql
CREATE TYPE verification_type AS ENUM (
  'NIN', 'BVN', 'LIVENESS', 'CAC', 'BANK_ACCOUNT_NAME_MATCH',
  'ADDRESS', 'DOCUMENT', 'SOCIAL_PROOF'
);

CREATE TYPE verification_request_status AS ENUM (
  'SUBMITTED',   -- user/system initiated, not yet sent to provider
  'PROVIDER_PENDING',  -- sent, awaiting provider response/webhook
  'PROVIDER_PASSED',
  'PROVIDER_FAILED',
  'MANUAL_REVIEW',   -- ambiguous provider result, or provider flagged
  'APPROVED',   -- terminal: counts toward level
  'REJECTED',   -- terminal: does not count toward level
  'EXPIRED'   -- stale, never completed
);

CREATE TYPE kyc_provider AS ENUM (
  'SMILE_IDENTITY', 'YOUVERIFY', 'PREMBLY', 'DOJAH', 'VERIFYME', 'MANUAL'
);

CREATE TYPE duplicate_flag_status AS ENUM (
  'OPEN', 'CONFIRMED_DUPLICATE', 'CLEARED_FALSE_POSITIVE', 'ESCALATED'
);

CREATE TYPE review_queue_status AS ENUM ('PENDING', 'ASSIGNED', 'DECIDED');

CREATE TYPE social_proof_platform AS ENUM ('INSTAGRAM', 'X');
```

### 6.2 Verification requests — the umbrella record

```sql
CREATE TABLE verification_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,   -- FK to identity.users(id); cross-schema FK
                                       -- enforced at app layer (see note below)
  verification_type  verification_type NOT NULL,
  status             verification_request_status NOT NULL DEFAULT 'SUBMITTED',
  provider           kyc_provider,
  provider_reference text,   -- provider's own call/session ID — the retrieval key for D1
  target_level       smallint NOT NULL,   -- which of 2/3/4 this contributes to
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  provider_called_at timestamptz,
  decided_at         timestamptz,
  expires_at         timestamptz NOT NULL,   -- unresolved requests don't hang forever
  rejection_reason   text,
  metadata           jsonb   -- provider-specific, non-sensitive fields only. Never raw NIN/BVN.
);

CREATE INDEX verification_requests_user_idx ON verification_requests (user_id);
CREATE INDEX verification_requests_status_idx ON verification_requests (status)
  WHERE status IN ('PROVIDER_PENDING', 'MANUAL_REVIEW');
CREATE INDEX verification_requests_expiry_idx ON verification_requests (expires_at)
  WHERE status NOT IN ('APPROVED', 'REJECTED', 'EXPIRED');
```

> Every `user_id` in this schema is a soft reference to `identity.users(id)`, not a real foreign key — M1 and M6 are separate schemas in the same database at this stage of the modular monolith, and a real cross-schema FK would couple their migration order tighter than the module boundary should allow. Enforce referential integrity at the application layer instead. If M1 is ever split into its own database, nothing here needs to change.

### 6.3 NIN / BVN verification outcomes

```sql
CREATE TABLE nin_verifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid NOT NULL REFERENCES verification_requests(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL,
  nin_masked         text NOT NULL,   -- '****-****-1234' display form only
  nin_hash           bytea NOT NULL,   -- HMAC-SHA256(nin_normalised, secret) — see D1
  name_match_score   numeric(5,2),   -- provider-returned confidence, if given
  dob_match          boolean,
  provider           kyc_provider NOT NULL,
  provider_reference text NOT NULL,
  verified_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- The core anti-fraud constraint (D2): a NIN that has ever passed verification
-- can back at most one ACTIVE user. Partial index so a REJECTED/EXPIRED prior
-- attempt against the same NIN by the same or another user doesn't collide.
CREATE UNIQUE INDEX nin_verifications_hash_active_unique
  ON nin_verifications (nin_hash) WHERE verified_at IS NOT NULL;

CREATE INDEX nin_verifications_user_idx ON nin_verifications (user_id);

CREATE TABLE bvn_verifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid NOT NULL REFERENCES verification_requests(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL,
  bvn_masked         text NOT NULL,
  bvn_hash           bytea NOT NULL,
  name_match_score   numeric(5,2),
  phone_match        boolean,   -- BVN-registered phone vs M1 verified phone
  provider           kyc_provider NOT NULL,
  provider_reference text NOT NULL,
  verified_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX bvn_verifications_hash_active_unique
  ON bvn_verifications (bvn_hash) WHERE verified_at IS NOT NULL;
CREATE INDEX bvn_verifications_user_idx ON bvn_verifications (user_id);
```

### 6.4 Liveness

```sql
CREATE TABLE liveness_checks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid NOT NULL REFERENCES verification_requests(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL,
  matched_against    verification_type NOT NULL,   -- which identity doc the selfie was matched to
  match_score        numeric(5,2) NOT NULL,
  liveness_passed    boolean NOT NULL,
  selfie_storage_ref uuid,   -- M20 file reference; nullable if provider doesn't return the image
  provider           kyc_provider NOT NULL,
  provider_reference text NOT NULL,
  checked_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX liveness_checks_user_idx ON liveness_checks (user_id);
```

### 6.5 Business verification (level 3)

```sql
CREATE TABLE business_verifications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id            uuid NOT NULL REFERENCES verification_requests(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL,   -- the verified proprietor/owner (must already be level 2)
  cac_rc_number         text NOT NULL,   -- not sensitive like NIN/BVN — stored plainly
  registered_business_name text NOT NULL,
  business_type         text,   -- see note below for enum-style values
  cac_status            text,   -- provider's reported status: active, inactive, not found
  officers_match         boolean,   -- is the submitter a registered officer?
  provider              kyc_provider NOT NULL,
  provider_reference    text NOT NULL,
  verified_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX business_verifications_user_idx ON business_verifications (user_id);
CREATE INDEX business_verifications_rc_idx ON business_verifications (cac_rc_number);
```

`business_type` holds values like `BUSINESS_NAME`, `LIMITED_LIABILITY`, `INCORPORATED_TRUSTEE` — left as free text rather than an enum since CAC's own classification scheme has more variants than are worth enumerating in the database layer. A given CAC registration can legitimately back more than one staff account under M5's `merchant_staff` model, but should not silently back two *different, unrelated* merchant records — that check is a duplicate-flag case (§7), not a hard DB constraint, since legitimate re-registration happens.

```sql

CREATE TABLE bank_account_name_matches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid NOT NULL REFERENCES verification_requests(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL,
  account_number_masked text NOT NULL,   -- last 4 digits; full account is M8's record
  bank_code          text NOT NULL,
  resolved_account_name text,   -- what the provider/bank returned
  expected_name      text NOT NULL,   -- verified identity or business name being matched against
  match_result       text NOT NULL,   -- 'EXACT' | 'FUZZY_MATCH' | 'MISMATCH'
  match_score        numeric(5,2),
  provider           kyc_provider NOT NULL,
  provider_reference text NOT NULL,
  checked_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bank_account_name_matches_user_idx ON bank_account_name_matches (user_id);
```

### 6.6 Address, documents, social proof

```sql
CREATE TABLE address_checks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid NOT NULL REFERENCES verification_requests(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL,
  address_line1      text NOT NULL,
  city               text NOT NULL,
  state              text NOT NULL,
  method             text NOT NULL,   -- 'UTILITY_BILL' | 'BANK_STATEMENT' | 'PROVIDER_LOOKUP'
  document_ref       uuid,   -- M20 file reference, if document-based
  passed             boolean,
  checked_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE verification_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid NOT NULL REFERENCES verification_requests(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL,
  document_type      text NOT NULL,
    -- 'NATIONAL_ID'|'PASSPORT'|'DRIVERS_LICENSE'|'CAC_CERTIFICATE'|'UTILITY_BILL'
  storage_ref        uuid NOT NULL,   -- M20 file id — see D5
  authenticity_check_passed boolean,
  provider           kyc_provider,
  provider_reference text,
  uploaded_at        timestamptz NOT NULL DEFAULT now(),
  reviewed_at        timestamptz
);

CREATE INDEX verification_documents_user_idx ON verification_documents (user_id);

-- Social proof (M1 §7.2): Instagram/X ownership claims. Never login.
CREATE TABLE social_proof_claims (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  platform           social_proof_platform NOT NULL,
  handle             text NOT NULL,
  challenge_code     text NOT NULL,   -- the one-time bio/post code the user must display
  verified           boolean NOT NULL DEFAULT false,
  verified_at        timestamptz,
  last_checked_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX social_proof_claims_user_platform ON social_proof_claims (user_id, platform)
  WHERE verified = true;
```

### 6.7 Duplicate-identity detection (D2, expanded in §7)

```sql
CREATE TABLE duplicate_identity_flags (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier_type    verification_type NOT NULL,   -- 'NIN' | 'BVN' | typically
  identifier_hash    bytea NOT NULL,
  first_user_id      uuid NOT NULL,   -- the account that verified it first
  conflicting_user_id uuid NOT NULL,   -- the account that tried to verify the same identifier
  status             duplicate_flag_status NOT NULL DEFAULT 'OPEN',
  detected_at        timestamptz NOT NULL DEFAULT now(),
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  resolution_notes   text,
  CONSTRAINT duplicate_flags_distinct_users CHECK (first_user_id <> conflicting_user_id)
);

CREATE INDEX duplicate_identity_flags_status_idx ON duplicate_identity_flags (status)
  WHERE status IN ('OPEN', 'ESCALATED');
CREATE INDEX duplicate_identity_flags_hash_idx ON duplicate_identity_flags (identifier_hash);
```

### 6.8 Manual review queue

```sql
CREATE TABLE kyc_review_queue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid NOT NULL REFERENCES verification_requests(id) ON DELETE CASCADE,
  reason             text NOT NULL,
    -- 'PROVIDER_LOW_CONFIDENCE'|'DUPLICATE_FLAG'|'MANUAL_ESCALATION'
  status             review_queue_status NOT NULL DEFAULT 'PENDING',
  assigned_to        uuid,   -- a KYC_ANALYST (M1 RBAC role)
  assigned_at        timestamptz,
  decision           text,   -- 'APPROVE' | 'REJECT' | 'REQUEST_MORE_INFO'
  decision_reason    text,
  decided_at         timestamptz,
  sla_due_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX kyc_review_queue_pending_idx ON kyc_review_queue (sla_due_at) WHERE status = 'PENDING';
CREATE INDEX kyc_review_queue_assigned_idx
  ON kyc_review_queue (assigned_to) WHERE status = 'ASSIGNED';
```

### 6.9 Enhanced due diligence (level 4 — deliberately minimal, D-in-§4)

```sql
CREATE TABLE enhanced_due_diligence_reviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  reason             text NOT NULL,
  reviewed_by        uuid NOT NULL,
  approved           boolean NOT NULL,
  notes              text,
  supporting_docs    uuid[] NOT NULL DEFAULT '{}',   -- M20 file references
  decided_at         timestamptz NOT NULL DEFAULT now()
);
```

### 6.10 Provider call log

```sql
CREATE TABLE kyc_provider_calls (
  id                 bigserial PRIMARY KEY,
  request_id         uuid REFERENCES verification_requests(id) ON DELETE SET NULL,
  provider           kyc_provider NOT NULL,
  call_type          verification_type NOT NULL,
  http_status        integer,
  latency_ms         integer,
  cost_estimate_kobo integer,   -- for reconciliation against opaque vendor pricing, see §10
  called_at          timestamptz NOT NULL DEFAULT now(),
  succeeded          boolean NOT NULL
);

CREATE INDEX kyc_provider_calls_provider_idx ON kyc_provider_calls (provider, called_at DESC);
```

### 6.11 Verification level change log (append-only, mirrors M1 §5.11)

```sql
CREATE TABLE verification_level_changes (
  id             bigserial PRIMARY KEY,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  user_id        uuid NOT NULL,
  from_level     smallint NOT NULL,
  to_level       smallint NOT NULL,
  direction      text NOT NULL,   -- 'GRANT' | 'REVOKE'
  triggering_request_id uuid REFERENCES verification_requests(id),
  reason         text NOT NULL,
  actor_type     text NOT NULL,   -- 'PROVIDER_AUTO' | 'KYC_ANALYST' | 'SYSTEM'
  actor_id       uuid
);

CREATE INDEX verification_level_changes_user_idx
  ON verification_level_changes (user_id, occurred_at DESC);

GRANT INSERT, SELECT ON verification_level_changes TO kumtru_app;
GRANT USAGE, SELECT ON SEQUENCE verification_level_changes_id_seq TO kumtru_app;

CREATE FUNCTION verification_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'verification_level_changes is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER verification_audit_no_mutate
  BEFORE UPDATE OR DELETE ON verification_level_changes
  FOR EACH STATEMENT EXECUTE FUNCTION verification_audit_immutable();
```

---

## 7. Duplicate-identity detection — the hard problem

This gets the same treatment M1 gave username confusables, because the failure mode is just as exploitable: a seller gets suspended for fraud, registers a new Kumtru account with a different email and phone, and re-verifies with the **same NIN**. Without a check, they're back in business under a new handle with a clean reputation. `nin_verifications_hash_active_unique` (§6.3) is the backstop, but the backstop alone produces a bad user experience if it just silently fails — the flow needs to be explicit:

```
User submits NIN for verification
        │
        ▼
Provider confirms the NIN is real and name-matches
        │
        ▼
Kumtru checks nin_hash against existing VERIFIED rows
        │
   ┌────┴────┐
   │         │
  NO        YES — hash already verified on a DIFFERENT active user
MATCH        │
   │         ▼
   │    Is the existing owner's account SUSPENDED or CLOSED?
   │         │
   │    ┌────┴────┐
   │    │         │
   │   YES        NO — existing owner is ACTIVE
   │    │         │
   │    ▼         ▼
   │  Insert duplicate_identity_flags row (status OPEN),
   │  route to kyc_review_queue with reason
   │  'DUPLICATE_FLAG'. Do NOT auto-approve OR
   │  auto-reject — a human decides. Common
   │  legitimate cases: the original account was
   │  the user's own abandoned account (self-
   │  duplicate, not fraud), or NIN reassignment
   │  error on NIMC's side (rare but real).
   │
   ▼
Verification proceeds normally, level attained.
```

**Why not just auto-reject the second attempt?** Because the false-positive cost is real: someone's old, genuinely-abandoned account holding their NIN hostage against a new legitimate one is a support nightmare and a plausible NDPA rectification complaint. Same trade-off logic M1 used for username confusables (§6.3 there) — bias toward a human reviewing the ambiguous case rather than a rule getting it wrong at scale in either direction.

**Same pattern applies to BVN and to CAC RC numbers**, with one adjustment for CAC: a single RC number legitimately backs multiple *staff* accounts under M5's `merchant_staff` model, so the duplicate check for business verification is scoped to "is this RC number already claimed as the *primary verified business* by a different, unrelated merchant record" — not "has any user ever referenced this RC number."

---

## 8. Provider evaluation

Researched as of August 2026 (see Sources). Direct integration with NIMC or NIBSS is not realistically available to a platform at Kumtru's stage — both gate access behind licensed-partner programs rather than open APIs — so this is a provider *selection* decision, not a build-vs-buy one.

| Provider | NIN | BVN | Liveness | CAC | Bank name-match | Pricing | Notes |
|---|---|---|---|---|---|---|---|
| **Smile Identity** | ✓ | ✓ | ✓ (strong, Africa-tuned) | Not confirmed | Not confirmed | Not public; quote-based | Mastercard took a minority stake and extended its partnership in Sept 2025 — a real signal of stability for a vendor Kumtru would depend on long-term |
| **Youverify** | ✓ | ✓ | ✓ | Implied under KYB suite | ✓ (explicit NUBAN endpoint) | Not public | Positions as a full KYC/KYB/AML compliance suite, not just verification |
| **Prembly** (formerly Identitypass/QoreID) | ✓ (incl. virtual NIN) | ✓ | ✓ | Likely, not fully confirmed | Not confirmed | Publicly cites "from $0.50/check" — treat as indicative | Unified dashboard/SSO shipped Feb 2025 |
| **Dojah** | ✓ | ✓ | ✓ | Not confirmed | Via "Financial Connection" tool | Publishes ~$0.04/check pay-as-you-go (self-reported) | Most transparent public pricing of the group |
| **VerifyMe Nigeria** | ✓ | Not clearly confirmed | ✓ | Not clearly confirmed | Not confirmed | Quote-based only | Least documented publicly of the five |

**Recommendation: start with Dojah as the primary adapter implementation, Smile Identity as the secondary.** Dojah's pricing is the most transparent (important when Kumtru can't yet predict verification volume), and having a second, well-capitalized provider (Smile Identity, now Mastercard-backed) wired in from day one via the same adapter interface (D3) means a coverage gap or a price hike from either one is a config flip, not an emergency rewrite. **Caveat, stated as plainly as M1 stated its X/Instagram pricing caveat:** several of these pricing figures came from JS-rendered pages that don't serve clean data to automated research, and per-check-type pricing (NIN vs. BVN vs. liveness typically differ) wasn't fully resolved for any provider. Get a live quote from both Dojah and Smile Identity before committing spend — this table is a starting shortlist, not a signed contract.

**Regulatory note surfaced by this research, worth a legal read before launch:** the CBN's payment-data localisation directive requires payment/trade data to be stored and managed inside Nigeria, with a compliance deadline of **January 1, 2027**. That's about payment/trade data specifically (relevant to M8, not primarily this module), but it's close enough to Kumtru's business that it belongs on the pre-launch legal checklist, not just a footnote here.

---

## 9. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `verification.submitted` | requestId, userId, type | Notifications |
| `verification.level_attained` | userId, level, requestId | **Identity (M1)** — updates `users.verification_level`; Notifications; Audit |
| `verification.level_revoked` | userId, fromLevel, toLevel, reason | **Identity (M1)**; Notifications; Risk (M13); Tickets |
| `verification.rejected` | requestId, userId, reason | Notifications; Tickets (auto-opens a case if the user has retried 2+ times — see below) |
| `verification.duplicate_identity_detected` | identifierType, firstUserId, conflictingUserId | Risk (M13, high priority); Tickets; Audit |
| `verification.manual_review_assigned` | reviewId, analystId, slaDueAt | Notifications (internal) |
| `verification.provider_degraded` | provider, callType, errorRate | Ops/Admin alerting — a provider outage shouldn't silently stall every level-2 attempt platform-wide |

`verification.rejected` firing twice for the same user within 30 days auto-opens a ticket in M10, same pattern M1 used for `identity.session.reuse_detected` and `identity.account.recovery_requested` — repeated KYC failure is exactly the kind of thing that needs a human before a frustrated user gives up on the platform entirely.

---

## 10. RBAC — this module's slice of M1's baseline

M1 §12 already defines `KYC_ANALYST` ("Verification review") in the platform RBAC table. This module adds the concrete permissions that role needs:

```
verification.view
verification.review   -- act on kyc_review_queue items
verification.override
  -- grant/revoke a level outside the normal provider flow
  -- (dual-approval, per M1's admin_action_approvals pattern)
duplicate_flag.view
duplicate_flag.resolve
provider_call.view   -- for cost/ops debugging, not PII
```

`verification.override` should route through M1's existing `admin_action_approvals` table (§5.7 there) rather than this module inventing a parallel approval mechanism — one dual-approval pattern platform-wide, not N of them.

---

## 11. API surface

```
POST   /verification/nin              submit NIN + trigger provider check
POST   /verification/bvn              submit BVN + trigger provider check
POST   /verification/liveness         submit selfie, matched against most recent NIN/BVN check
POST   /verification/business         submit CAC number for business verification
POST   /verification/bank-account     submit account number + expected name for name-match
POST   /verification/address          submit address + supporting document
POST   /verification/social-proof     claim an Instagram/X handle, returns challenge code
POST   /verification/social-proof/:id/confirm   check the challenge code is live on the platform

GET    /verification/status           current level + in-flight requests for the calling user

# Admin / KYC_ANALYST surface
GET    /admin/kyc/queue
POST   /admin/kyc/queue/:id/assign
POST   /admin/kyc/queue/:id/decide
GET    /admin/kyc/duplicate-flags
POST   /admin/kyc/duplicate-flags/:id/resolve
```

As with M1 §27's rule: the frontend never decides a verification outcome. It submits, and polls or receives a webhook-driven push for the result. "Provider said liveness passed" is a backend fact, not a client-asserted one.

---

## 12. NDPA and data-sensitivity implications for Module 0

This is the section that actually changes something outside this document. Module 0 §2a justified deferring AWS KMS in favor of env-var encryption partly on the grounds that Kumtru had "no live NIN/BVN handling" yet. Building this module is precisely the event that condition was written to anticipate.

**What this module stores that Module 0's env-var approach now has to protect:** `nin_hash` / `bvn_hash` (HMAC outputs — not reversible to the original number, but still a linkable identifier), liveness match scores and selfie references, and (via M20) the underlying KYC document images. None of these are as directly damaging as a plaintext NIN would be if D1 is followed correctly, but a breach that correlates hashed identifiers across accounts, or that exposes selfie images tied to real names, is a materially different risk than the TOTP-seed/OAuth-token blast radius Module 0's §2a scoped its trade-off around.

**Recommendation:** treat "M6 ships to production" as an explicit trigger to revisit Module 0's encryption decision, in addition to the triggers already listed there (real escrow funds moving, user count growth, a compliance review). This doesn't have to mean flipping to AWS KMS the day this module merges — the HMAC secret for `nin_hash`/`bvn_hash` specifically is a good candidate to move to a proper key-management service first, ahead of the broader env-var-to-KMS migration, since it's the one secret in this module where a leak has an irreversible, cross-account correlation consequence that no amount of "we'll rotate it later" fixes retroactively.

---

## 13. What I would specify next

Unchanged from M1 §20's ordering, now with M6 done: **Trade Management (M7)** next — it's the spine, and it's the thing every other P0 module (Merchant, Payment, Disputes, Orders) is written in terms of. Payment, Escrow & Ledger (M8) and Notifications (M11) follow, in that order, per M1's original reasoning.

---

## Sources

- [NIMC Verification Service (NVS) API](https://nimc.gov.ng/nimc-verification-service-api)
- [NIMC Approved/Licensed Service Providers](https://nimc.gov.ng/approved-licensed-service-providers)
- [NIMC suspends third-party NIN registration agents — Nairametrics, Jan 2024](https://nairametrics.com/2024/01/19/nimc-suspends-third-party-agents-from-nin-registration/)
- [NIMC temporarily suspends bypass enrolment process — The Cable](https://www.thecable.ng/nimc-temporarily-suspends-bypass-enrolment-process/)
- [NIBSS Verification Service (NVS)](https://nibss-plc.com.ng/nvs)
- [NIBSS BVN SDK](https://nibss-plc.com.ng/bvn-sdk)
- [Smile Identity — Nigeria](https://usesmileid.com/countries/nigeria)
- [Smile Identity / Mastercard partnership — Disrupt Africa, Sept 2025](https://disruptafrica.com/2025/09/30/)
- [Dojah — Best Identity Verification APIs in Africa 2026](https://dojah.io/blog/best-identity-verification-api-africa-2026)
- [Dojah — KYC Pricing in Nigeria](https://dojah.io/blog/kyc-pricing-nigeria)
- [Youverify — Nigeria KYC/eIDV documentation](https://doc.youverify.co)
- [Youverify — CBN KYC/AML requirements 2026](https://youverify.co/en/blogs/cbn-kyc-aml-requirements-2026)
- [Prembly pricing](https://prembly.com/pricing)
- [Prembly — NIN and Virtual NIN docs](https://docs.prembly.com/docs/nin-and-virtual-nin-copy)
- [VerifyMe Nigeria documentation](https://docs.verifyme.ng)
- [CBN payment data localisation directive — TechBuild Africa](https://techbuild.africa/cbn-data-localisation-nigeria-payment-data)
- [Nigeria cross-border data transfer regulation — ITIF](https://itif.org/publications/2025/06/09/nigeria-cross-border-data-transfer-regulation)

**Note on the pricing figures above:** several provider pricing pages are JavaScript-rendered and didn't yield clean figures to automated research; treat all quoted numbers as directional and get a live sales quote from Dojah and Smile Identity before committing.
