# Kumtru — Module 20: File & Evidence Management

**Implementation specification**
Version 0.2 · 23 August 2026 · Status: Draft for engineering review
*(Revision note: this version replaces the AWS S3 storage backend from v0.1 with a
5-account Cloudinary free-tier pool — see §2 D5-D7. No other module's behavior changes;
every consumer still only ever talks to this module's upload/retrieval API, per D1.)*

---

## 0. How to read this document

This is the last module in the set, and by count it's the most-referenced one that didn't yet exist: listing images (M5), KYC documents (M6), dispute evidence (M3), proof-of-delivery photos (M2), ticket attachments (M10) — every one of them a "soft ref to M20" scattered through five other specs, written on the assumption that this module would eventually justify the reference. It now does.

The reason this wasn't specced first, despite being so widely depended on, is the same reason M1 §20 put Trust & Verification and Trade Management ahead of nearly everything else: a generic file-storage module is easy to get *approximately* right and easy to get *access control* badly wrong, and getting it wrong is much more dangerous once modules holding NIN/BVN-adjacent documents (M6) and financially consequential evidence (M3) are already depending on it. Specifying it last, once every consumer's actual access-control need is already on paper, means this module's permission model is built from real requirements instead of guesses.

**Why Cloudinary instead of the AWS S3 plan from v0.1:** the same MVP-economics reasoning that led to shopping around for free Postgres hosting applies here — a single S3 bucket has one free-tier ceiling, but five independent Cloudinary accounts have five. Emmanuel's plan (2026-08-23) is to run five free-tier Cloudinary accounts: one dedicated to profile photos, one dedicated to chat attachments, and three pooled together — rotated across — for every trade-related asset (KYC documents, dispute evidence, proof-of-delivery photos, listing images, ticket attachments, and anything else that doesn't fit the first two buckets). The access-control model this module already had (D1-D4 below) doesn't change at all; only the storage mechanism underneath it does.

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Upload/storage | One pipeline backing every module's file needs, Cloudinary-backed across 5 pooled, rotated free-tier accounts (§2 D5-D7) |
| Access control | Per-file visibility class, checked on every retrieval |
| Evidence-specific access | Multi-party access for dispute evidence, reviewer access for KYC documents |
| Storage-account health | Usage tracking and rotation across the pooled accounts, so no single free-tier ceiling silently blocks uploads |
| Lifecycle | Tombstoning (soft delete), driven by M15's retention policy |
| Access logging | Who viewed a sensitive file, when |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Every consuming module | The business meaning of a file — M20 doesn't know what a "dispute evidence photo" proves, only that `dispute_evidence` referenced it and who's allowed to see it |
| Audit & Compliance (M15) | Retention policy decisions — M20 executes the tombstoning M15 requests, doesn't set the policy |
| Trust & Verification (M6) | What counts as a valid KYC document — M20 just stores and gates access to the file M6 uploaded |

> **Boundary note:** M20 is the one module in this set with no domain knowledge of its own — it's pure infrastructure with an access-control model attached. That's deliberate: every module above it already decided what a file *means*; this module only has to get *who can retrieve which bytes* right, consistently, everywhere — regardless of which of the 5 storage accounts the bytes actually live in.

---

## 2. Core design decisions

### D1 — One file service backs every module, never a per-module storage integration

Every module that needs file storage — M2's delivery photos, M3's dispute evidence, M5's listing images, M6's KYC documents, M10's ticket attachments, M1's profile photos, and the future dispute-mediation chat's attachments — goes through this module's upload and retrieval API. There is exactly one place that issues upload credentials, one access-control model to get right and keep right, rather than several slightly-different implementations drifting apart over time. Callers pass a `category` (§4); they never choose or even see which storage account or provider actually holds the bytes.

### D2 — Every file has an explicit visibility class set at upload time, never inferred later

```
PUBLIC         anyone can view (e.g. listing photos)
PRIVATE_OWNER  only the uploading user (e.g. a user's own KYC documents)
PRIVATE_CASE   the case's participants plus assigned reviewers (e.g. dispute
               evidence — visible to buyer, seller, and the assigned
               DISPUTE_REVIEWER/DISPUTE_LEAD, no one else)
INTERNAL_ONLY  staff only (e.g. an internal fraud-review attachment)
```

The visibility class is set by the uploading module at upload time and never guessed from context afterward — a file-serving layer that tried to infer "this looks like a KYC document, better restrict it" is a security model built on pattern-matching instead of an explicit decision, and this module doesn't do that.

### D3 — Storage keys are opaque; access always goes through a signed URL, never a public delivery path

Every file's storage object id (Cloudinary calls this a `public_id`) is a randomized (`gen_random_uuid()`-derived) opaque string, never sequential or containing user-identifying text. Every asset is uploaded with Cloudinary's `type: authenticated` — the private, access-controlled delivery mode, not `upload`'s public-by-default mode — so no Cloudinary account ever has a bucket-equivalent that's publicly browsable or guessable. Even `PUBLIC` visibility files (D2) are served through a short-lived, cryptographically signed delivery URL issued by this module's API, never a bare Cloudinary URL a client could reconstruct or share indefinitely. This is the identical guarantee the original S3-backed design made in v0.1 — only the mechanism producing the signed URL changed.

### D4 — Deletion is always a tombstone, never a hard row delete, because soft references depend on it

Every other module in this spec set holds a "soft ref to M20" — a `file_ref_id` with no real foreign key. If a file row were hard-deleted, every one of those references would silently dangle. Deletion (whether from an M15-driven retention policy or an NDPR data-subject request) tombstones the row (`status = TOMBSTONED`, the Cloudinary asset actually destroyed via that account's Admin API, reason logged) — the reference stays resolvable to "this file existed and was removed for reason X," never to nothing at all.

### D5 — Storage accounts are pooled by purpose, never by individual file category

Five Cloudinary accounts, three pools:

```
PROFILE          1 dedicated account   — category PROFILE_PHOTO only
CHAT_ATTACHMENT  1 dedicated account   — category CHAT_ATTACHMENT only
                                          (the future dispute-mediation chat)
TRADE_ASSET      3 accounts, rotated   — every other category: KYC_DOCUMENT,
                                          DISPUTE_EVIDENCE, PROOF_OF_DELIVERY,
                                          LISTING_IMAGE, TICKET_ATTACHMENT, OTHER
```

The two low-and-predictable-volume categories each get one account for life — there's nothing to rotate and no benefit to spreading a trickle of profile photos across three accounts. Everything trade-related is pooled precisely because it's the highest-volume, hardest-to-predict-in-advance category mix, and one free-tier ceiling would be the first thing this platform outgrows. KYC documents landing in the same pool as dispute evidence and listing images is a deliberate simplification Emmanuel chose over a 6th dedicated account (2026-08-23) — it costs nothing at the access-control layer, since D2's visibility class is per-file and doesn't care which account a file lives in.

### D6 — Rotation across the trade-asset pool is quota-aware round-robin, never fixed by sub-category

A naive fixed mapping ("shipping evidence always goes to account A") just recreates three single-purpose buckets with extra steps — one of the three would still fill up first while the others sit idle. Instead:

- Each upload into the `TRADE_ASSET` pool goes to the next account in rotation order, skipping any account currently `NEAR_QUOTA` or `DISABLED` (§5).
- A scheduled job syncs real usage from each account's Cloudinary Admin API on a fixed interval and flips `storage_accounts.status` before an account actually fails a real upload, not after.
- If every pooled account is `DISABLED`, uploads to that pool fail closed with a clear error — never silently falling back to an unpooled or insecure path. The runbook is simply: provision a 6th account, insert its `storage_accounts` row, and rotation resumes automatically with no code change.

### D7 — Every `file_records` row pins the exact storage account it lives in

Unlike the v0.1 design, where one shared set of AWS credentials could resolve any object in any of the three S3 buckets, each Cloudinary account is a fully separate set of credentials (`cloud_name` + `api_key` + `api_secret`) with no shared namespace. Generating a valid signed delivery URL, or issuing a deletion call, is impossible without first knowing exactly which of the 5 accounts issued that object. `file_records.storage_account_id` (§3.4) is that answer, recorded once at upload time and never re-derived — this is the whole reason accessibility stays simple even with 5 independent accounts instead of one bucket.

---

## 3. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS files;
SET search_path TO files, public;
```

### 3.1 Enumerations

```sql
CREATE TYPE file_visibility AS ENUM (
  'PUBLIC', 'PRIVATE_OWNER', 'PRIVATE_CASE', 'INTERNAL_ONLY'
);

CREATE TYPE file_status AS ENUM ('ACTIVE', 'TOMBSTONED');

CREATE TYPE file_category AS ENUM (
  'LISTING_IMAGE', 'KYC_DOCUMENT', 'DISPUTE_EVIDENCE', 'PROOF_OF_DELIVERY',
  'TICKET_ATTACHMENT', 'PROFILE_PHOTO', 'CHAT_ATTACHMENT', 'OTHER'
);

CREATE TYPE storage_pool AS ENUM ('PROFILE', 'CHAT_ATTACHMENT', 'TRADE_ASSET');

CREATE TYPE storage_account_status AS ENUM ('ACTIVE', 'NEAR_QUOTA', 'DISABLED');
```

### 3.2 Storage accounts (D5-D7)

```sql
CREATE TABLE storage_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool                  storage_pool NOT NULL,
  label                 text NOT NULL UNIQUE,   -- 'profile'|'chat'|'trade-1'|'trade-2'|'trade-3'
  cloud_name            text NOT NULL UNIQUE,   -- the Cloudinary account's cloud name
  credential_env_prefix text NOT NULL UNIQUE,   -- e.g. 'CLOUDINARY_TRADE_1', see Module 0 §7
  status                storage_account_status NOT NULL DEFAULT 'ACTIVE',
  rotation_order        smallint,   -- only meaningful within the TRADE_ASSET pool
  storage_used_bytes    bigint NOT NULL DEFAULT 0,
  credits_used_pct      numeric(5,2) NOT NULL DEFAULT 0,   -- D6's thresholds read this
  last_usage_synced_at  timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- D5: PROFILE and CHAT_ATTACHMENT are single-account pools by design — enforced
-- structurally, not just by convention, so a second dedicated account can never
-- accidentally split that pool's traffic.
CREATE UNIQUE INDEX storage_accounts_singleton_pool
  ON storage_accounts (pool)
  WHERE pool IN ('PROFILE', 'CHAT_ATTACHMENT') AND status <> 'DISABLED';
```

### 3.3 Trade-asset pool rotation cursor (D6)

```sql
CREATE TABLE storage_pool_rotation (
  pool            storage_pool PRIMARY KEY,
  last_account_id uuid REFERENCES storage_accounts(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- In practice only ever has a 'TRADE_ASSET' row — PROFILE and CHAT_ATTACHMENT
-- never rotate (D5), so they never need a cursor.
```

### 3.4 Files

```sql
CREATE TABLE file_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_user_id    uuid NOT NULL,
  owning_module       text NOT NULL,   -- 'logistics'|'disputes'|'merchant'|'trust'|'support'
  category            file_category NOT NULL,
  visibility          file_visibility NOT NULL,   -- D2
  storage_account_id  uuid NOT NULL REFERENCES storage_accounts(id),   -- D7
  storage_object_id   text NOT NULL,   -- opaque Cloudinary public_id, D3
  content_type        text NOT NULL,
  size_bytes          bigint NOT NULL,
  status              file_status NOT NULL DEFAULT 'ACTIVE',
  created_at          timestamptz NOT NULL DEFAULT now(),
  tombstoned_at       timestamptz,
  tombstoned_reason   text
);

-- storage_object_id is only unique per account, not globally, since each of the
-- 5 Cloudinary accounts has its own independent id namespace.
CREATE UNIQUE INDEX file_records_account_object_unique
  ON file_records (storage_account_id, storage_object_id);

CREATE INDEX file_records_uploader_idx ON file_records (uploader_user_id);
CREATE INDEX file_records_category_idx ON file_records (category);
CREATE INDEX file_records_storage_account_idx ON file_records (storage_account_id);
```

### 3.5 Case-scoped access grants (for `PRIVATE_CASE`, D2)

```sql
CREATE TABLE file_access_grants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id         uuid NOT NULL REFERENCES file_records(id) ON DELETE CASCADE,
  grantee_user_id uuid,   -- either this...
  grantee_role    text,   -- ...or this (e.g. 'DISPUTE_REVIEWER'), not both
  granted_reason  text NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,

  CONSTRAINT file_access_grants_one_grantee_type
    CHECK (num_nonnulls(grantee_user_id, grantee_role) = 1)
);

CREATE INDEX file_access_grants_file_idx ON file_access_grants (file_id) WHERE revoked_at IS NULL;
```

### 3.6 Access log (append-only, for sensitive categories)

```sql
CREATE TABLE file_access_log (
  id              bigserial PRIMARY KEY,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  file_id         uuid NOT NULL REFERENCES file_records(id) ON DELETE CASCADE,
  accessed_by_user_id uuid,
  accessed_by_admin_id uuid,
  access_granted  boolean NOT NULL
);

CREATE INDEX file_access_log_file_idx ON file_access_log (file_id, occurred_at DESC);
```

---

## 4. Storage pool ↔ category mapping

A fixed application-code constant, deliberately not a DB-configurable table — mirrors M9's D2 stance that a purely structural fact belongs in code, not in a row someone could edit at 2am and misroute KYC documents:

```
PROFILE_PHOTO       → PROFILE
CHAT_ATTACHMENT      → CHAT_ATTACHMENT
KYC_DOCUMENT         → TRADE_ASSET
DISPUTE_EVIDENCE     → TRADE_ASSET
PROOF_OF_DELIVERY    → TRADE_ASSET
LISTING_IMAGE        → TRADE_ASSET
TICKET_ATTACHMENT    → TRADE_ASSET
OTHER                → TRADE_ASSET
```

Adding a new `file_category` value later means adding one line to this map, never a migration or a `storage_accounts` change.

---

## 5. Rotation & quota management (D6)

**Choosing an account for a `TRADE_ASSET`-pool upload:**

```
1. Read storage_pool_rotation.last_account_id for pool = 'TRADE_ASSET'
2. Candidates = storage_accounts WHERE pool = 'TRADE_ASSET' AND status = 'ACTIVE'
                ORDER BY rotation_order
3. If candidates is empty, retry the same query with status = 'NEAR_QUOTA'
   (still usable, just deprioritized — better than failing an upload outright)
4. If still empty: fail the upload closed (D6) and emit storage_account.disabled
   if not already emitted for this state
5. Pick the next candidate after last_account_id in rotation_order (wrapping
   around); update storage_pool_rotation.last_account_id to it
```

**Usage sync (BullMQ repeatable job, per Module 0 §5's pattern, hourly):**

For each of the 5 `storage_accounts` rows, call that account's Cloudinary Admin API `GET /usage` endpoint using its own credentials, and update `storage_used_bytes` / `credits_used_pct` / `last_usage_synced_at`. Then:

```
credits_used_pct >= 85%  →  status = 'NEAR_QUOTA'   (emit storage_account.near_quota)
credits_used_pct >= 97%  →  status = 'DISABLED'      (emit storage_account.disabled)
credits_used_pct  < 85%  →  status = 'ACTIVE'         (recovers automatically if
                                                        Cloudinary's monthly reset
                                                        brings usage back down)
```

Thresholds are placeholders, same "v1, deliberately simple, tune once real volume exists" posture as M12 §4's score formula — what matters structurally is that the sync job is the only writer of `storage_accounts.status`, never application code reacting ad hoc to a failed upload.

**Ops runbook, not engineering-time logic:** when a `TRADE_ASSET` account nears `DISABLED`, the fix is provisioning a 6th free-tier Cloudinary account and inserting one `storage_accounts` row with the next `rotation_order` — rotation (§5, step 2) picks it up automatically on the very next upload, no deploy required.

---

## 6. Upload & retrieval flow

**Upload:**

```
POST /files/upload-url { category }
        │
        ▼
  Resolve pool from category (§4)
        │
   PROFILE / CHAT_ATTACHMENT ──▶ account = that pool's one ACTIVE account
        │
   TRADE_ASSET ──▶ account = next eligible account per rotation (§5)
        │
        ▼
  Generate opaque storage_object_id (gen_random_uuid())
        │
        ▼
  Build a Cloudinary signed-upload payload using that account's api_secret:
  { timestamp, public_id: storage_object_id, type: 'authenticated',
    signature: SHA1(sorted_params_as_query_string + api_secret) }
        │
        ▼
  Insert file_records (status ACTIVE, storage_account_id, storage_object_id,
  category, visibility — D2)
        │
        ▼
  Return { file_id, cloud_name, upload_url, signed_params } to the caller,
  which POSTs the file directly to
  https://api.cloudinary.com/v1_1/{cloud_name}/auto/upload — api_secret
  itself never leaves this module's backend.
```

`POST /files/:id/finalize` confirms the direct-to-Cloudinary upload actually landed (checked against Cloudinary's own response — `public_id`, `bytes`, `format` — rather than trusting the client's word for it) and reconciles `size_bytes`/`content_type` if either was only knowable after the file was received.

**Retrieval:**

```
GET /files/:id
        │
        ▼
  Look up file_records row (includes storage_account_id — D7)
        │
   Look up visibility class
        │
   PUBLIC ────────────────────────▶ issue short-lived signed URL (D3)
        │
   PRIVATE_OWNER ──▶ caller = uploader_user_id? ──▶ signed URL : 403
        │
   PRIVATE_CASE ──▶ caller in file_access_grants (active)? ──▶ signed URL : 403
        │
   INTERNAL_ONLY ──▶ caller is staff with relevant role? ──▶ signed URL : 403
        │
        ▼
  On grant: look up storage_accounts row by storage_account_id, resolve its
  cloud_name/api_secret from env (via credential_env_prefix), and generate a
  signed, short-lived Cloudinary delivery URL for storage_object_id.

  Every check outcome for KYC_DOCUMENT / DISPUTE_EVIDENCE categories is
  written to file_access_log, matching M15's compliance_access_log posture
  for sensitive data (M15 §2 D4).
```

---

## 7. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `file.uploaded` | fileId, category, visibility, uploaderUserId | Audit (M15) |
| `file.access_granted` | fileId, granteeUserId or granteeRole, reason | Audit |
| `file.tombstoned` | fileId, reason | Audit, every consuming module (invalidate cached refs) |
| `storage_account.near_quota` | accountId, pool, creditsUsedPct | Ops alerting (M14 Platform health) |
| `storage_account.disabled` | accountId, pool, reason | Ops alerting, Audit |

## 8. Events consumed

| Event (from) | Effect |
|---|---|
| `compliance.retention_policy_applied` (M15) | Tombstones files in an expired data category |
| `compliance.dsr_fulfilled` type DELETE (M15) | Tombstones a specific user's files where retention policy permits |
| `dispute.opened` (M3) | Auto-creates `file_access_grants` for the assigned reviewer role once assigned |

---

## 9. API surface

```
POST   /files/upload-url               returns a signed Cloudinary upload payload + file_id
POST   /files/:id/finalize             confirms upload completed, reconciles metadata
GET    /files/:id                      returns a signed download URL if authorized
POST   /admin/files/:id/tombstone

# Internal / ops — backs the Platform health surface on the ops dashboard
GET    /internal/storage-accounts                 status + usage for all 5 accounts
POST   /internal/storage-accounts                 register a newly-provisioned account (D6 runbook)
```

---

## 10. Closing note

This completes the full remaining module set from Module 1 §20's recommendation, in the order worked through across this session: Trust & Verification (M6), Trade Management (M7), Payment & Ledger (M8), Notifications (M11), Orders (M9), Tickets (M10), Reputation (M12), Risk & Fraud (M13), Merchant Management (M5), Logistics (M2), Disputes (M3, full depth), Administration (M14), Audit & Compliance (M15), Reporting & Analytics (M16), Configuration (M17), Referral & Growth (M18), Search (M19), and this module. Together with the original Identity & User Management (M1) spec and the Module 0 infrastructure setup, every module in the confirmed and best-guess numbering scheme (per the project's module-numbering notes) now has an implementation specification. This v0.2 revision (2026-08-23) is the first post-completion change to any module, swapping this module's storage backend from AWS S3 to a 5-account Cloudinary free-tier pool without altering the access-control contract any other module already relies on.

**Follow-up actioned (2026-08-23):** M1's `users.avatar_url` column has been converted to `avatar_file_id`, a soft ref to this module's `PROFILE_PHOTO` category resolved to a signed URL at read time — see M1 §3 D7, §5.3, §5.6, §10.5, and its anonymisation procedure (§15). No module now holds its own ad hoc file-serving path; every consumer of file storage goes through this module's API, without exception.
