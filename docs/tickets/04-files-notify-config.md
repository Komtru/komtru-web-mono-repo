# Epic 04 — Files, notifications, configuration

---

### T-040 — Files and evidence (M20)

- **Touches:** `src/modules/files/**`, migration `files_*`
- **Depends on:** T-031, T-028, T-026
- **Cannibalized:** `files/infrastructure/cloudinary.ts`, `files/domain/rotation.ts`, `files/domain/pools.ts` (T-001)
- **Acceptance criteria:**
  - `storage_accounts` seeded from the five Cloudinary credential prefixes in the reused `.env`; pools `PROFILE`, `CHAT_ATTACHMENT`, `TRADE_ASSET` (three rotated accounts).
  - `POST /files/upload-url` returns signed params for a direct-to-Cloudinary `authenticated` upload with an opaque `public_id`; `POST /files/:id/finalize` reconciles size and type via a job; `GET /files/:id` returns a short-lived signed URL after the visibility check (`PUBLIC`, `PRIVATE_OWNER`, `PRIVATE_CASE` via `file_access_grants`, `INTERNAL_ONLY`).
  - Every access decision for `KYC_DOCUMENT`, `DISPUTE_EVIDENCE` and `CUSTODY_EVIDENCE` (new category for Park photos, in the trade-asset pool) is written to `file_access_log`.
  - Tombstoning destroys the asset via a job and keeps the row resolvable.
  - Usage-sync scheduled job marks accounts `NEAR_QUOTA`/`DISABLED` and emits the storage-account events.
  - Camera-capture metadata (server-received timestamp, uploader, hub id when present) stored with the record; the client's clock is never trusted.

### T-041 — Avatars

- **Touches:** `identity/services/avatar.service.ts`, `identity/http/me.controller.ts`
- **Depends on:** T-040, T-030
- **Acceptance criteria:** `POST /me/avatar { fileId }` and `DELETE /me/avatar` per M1 D7; `avatar_file_id` resolved to a signed URL at read time; provider avatars imported server-side through the same flow.

### T-045 — Notifications delivery pipeline (M11)

- **Touches:** `src/modules/notify/**`, migration `notify_*`
- **Depends on:** T-024, T-028
- **Acceptance criteria:**
  - Templates as data with versions and locales; event-to-template mappings; one `notifications` row per send; attempt history.
  - Send jobs on BullMQ with backoff and up to `NOTIFY_MAX_ATTEMPTS`; dead-lettered security notifications publish `notification.dead_lettered` (support opens a ticket in T-100).
  - Security-critical templates bypass preferences and rate limits; others respect per-category, per-channel preferences (NP1) and per-user caps.
  - Adapters: Mailjet (email), Termii (SMS), FCM (push); IN_APP feed (`GET /notifications`, mark-read) also pushed over the socket.
  - Identity templates (OTP, new-device, password changed, session reuse) seeded; every later module ticket adds its own templates and mappings.

### T-046 — Location catalog: states, cities and city requests

- **Touches:** `src/modules/geo/**`, migration `geo_*`, `packages/shared-types/src/geo.ts`, `packages/api-client` geo hooks
- **Depends on:** T-021, T-025, T-037
- **Acceptance criteria:**
  - `geo.states` (36 states plus the FCT, seeded) and `geo.cities` (state FK, display name, normalised name, aliases, `active`) with a unique index on (state, normalised name), so the same city cannot be added twice.
  - Seed file of state capitals and major commercial cities, reviewed by the owner before merge (design §12 Q16).
  - Dropdown APIs: `GET /geo/states`, `GET /geo/states/:stateId/cities` (active cities only) and `GET /geo/cities?q=&stateId=` (prefix and alias typeahead). All cursor-paginated with a page size big enough for one dropdown request, and cached in Redis with invalidation on any catalog change.
  - `geo.city_requests`: a user submits state plus a typed city name from "My city isn't listed"; status `PENDING`, `ADDED`, `MERGED`, `REJECTED`; the requester is notified of the outcome.
  - Staff endpoints behind `geo.manage`: add, rename and deactivate cities; review city requests (add as a new city, merge into an existing one, or reject with reason). Every change writes the admin action log. A city used by an address, hub or trade can be deactivated but never deleted, and deactivated cities stay readable on old records.
  - `api-client` hooks `useStates()` and `useCities(stateId)` shared by every app's dropdowns.

### T-047 — Fee schedule file

- **Touches:** `config/fees.yaml`, `packages/shared-types/src/fees/{schema,calculator}.ts`, `apps/backend-api/src/modules/config/fees.ts`, `tools/fee-version-check/**`, backend workflow step
- **Depends on:** T-010, T-020
- **Acceptance criteria:**
  - `config/fees.yaml` exactly as design §6.5, the single source for every fee and cut.
  - zod schema validates the file at boot and in CI; the backend refuses to start on an invalid file, naming the bad key.
  - `computeTradeFees` is pure and integer-only, rounds half up to the kobo, and has property tests: totals always equal the parts, no float ever appears, caps and minimums hold.
  - Backend fee module exposes `getFeeSchedule()` and `snapshotFees(...)`; `GET /config/fees` serves the current schedule for display.
  - CI fails when a value changes without a `version` bump.
  - A guard test fails on fee literals or on fee reads that bypass the fee module in ledger, trades, park or merchant code.
  - A short runbook in the file's header and in `docs/runbooks/fees.md` explains how to change a fee safely.

### T-048 — Configuration (M17)

- **Touches:** `src/modules/config/**`, migration `config_*`
- **Depends on:** T-024, T-037
- **Acceptance criteria:**
  - `platform_settings` (namespace, key), `feature_flags`, append-only `config_change_log`; typed accessor with Redis cache invalidated by `config.setting_changed`.
  - Seeds: every M17 §4 default, plus `disputes.mediation_window_hours = 48`, `park.custody_ageing_hours = 48`, `park.pin_max_attempts = 3`, `trades.payment_deadline_hours`, `trades.delivery_deadline_days`.
  - Admin endpoints per M17 §6 behind permissions; every change requires a reason and writes the change log and admin action log.
  - No fee or cut is stored here; those live only in the fee file (T-047, design §6.5). A test asserts no `platform_settings` key looks like a fee.

### T-049 — Trade Standards by category

- **Touches:** `config` schema `trade_standards`, `trade_categories`; `config/http/standards.controller.ts`
- **Depends on:** T-048
- **Acceptance criteria:**
  - Launch categories Electronics and Fashion (HTML K1). Per category: inspection window hours, required item-spec fields (brand, model, serial/IMEI, condition for electronics), proof-media requirements for seller acceptance, whether IMEI verification applies, delivery deadline default.
  - Read API for the CTS1 screen and for trade creation; changes are versioned and a trade snapshots the standard version it was created under.
  - The only direction a buyer can move a window is longer (BEI1), capped by a config maximum.
