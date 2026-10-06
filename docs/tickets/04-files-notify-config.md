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
  - **T-028:** upload signing is pure and stays in a non-client file a request handler may call; every call that reaches Cloudinary (finalize reconciliation, tombstone destroy, usage sync) goes in `files/infrastructure/providers/cloudinary.client.ts` and is imported only from `files/jobs/`.

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
  - Outside production, SMS and push run in dry-run mode by default (`NOTIFY_SMS_DRY_RUN`, `NOTIFY_PUSH_DRY_RUN`): the message is rendered, recorded and logged with the recipient masked, but never sent. Local runs keep live provider keys (T-003), so this is what stops them texting real people. A test proves no provider call is made in dry-run mode.
  - Identity templates (OTP, new-device, password changed, session reuse) seeded; every later module ticket adds its own templates and mappings.
- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-045-notifications.md`. Migrations `0016_notify_schema` (generated) and `0017_notify_append_only` (custom; `notification_delivery_attempts` can only grow). **The idempotency boundary is `notify.notifications.id`**: a uuid v5 over `(eventId, templateKey, channel, userId)` (`domain/identity.ts`), inserted `ON CONFLICT DO NOTHING` inside the subscriber's own transaction, so an event redelivery, a handler retry and two bindings racing all land on one row; the provider call is then gated on a conditional `UPDATE … WHERE status IN ('QUEUED','FAILED')` (`services/delivery.service.ts`), which is what actually stops a second SMS when the platform's `processed_events` marker is not in play (an operator retrying a 29-day-old failed job). Proven end to end in `test/integration/notifications.int.test.ts` by deleting the marker and handing the subscriber queue the same envelope again. Preferences and the per-user cap are decided by one pure function (`domain/decide.ts`): a security-critical template bypasses both, a `SECURITY`-category one is never rate-limited even if its flag is missing, and a security-critical message with no verified address is recorded `DEAD_LETTERED` with `notify.notification.dead_lettered` published (support's hook, T-100) rather than suppressed — `PUT /notification-preferences` refuses to store a `SECURITY` opt-out at all, since a setting the pipeline ignores is a lie. Templates are data: the shipped catalogue (`domain/catalogue.ts`) is zod-parsed at import, checked by `assertCatalogueIntegrity` as the first thing `start()` does (a placeholder no binding supplies, a mapping with no template, a `SECURITY` template missing its flag, or a key with nothing in the default locale stops the process at boot naming the offender), then insert-only-synced so an operator's edit is never stamped over — a copy change is a new `version`. Bindings (code: which event, which template, how to pull recipients and variables out of a payload) live in `domain/binding.ts` and are **empty**: no module publishes a user-facing event yet, so T-031/T-034 and T-068 add theirs next to the templates already seeded. New config: `NOTIFY_DEFAULT_LOCALE`, `NOTIFY_MAX_ATTEMPTS`, `NOTIFY_RETRY_BASE_DELAY_MS`, `NOTIFY_RATE_LIMIT_WINDOW_MINUTES`, `NOTIFY_RATE_LIMIT_MAX_PER_WINDOW`, `NOTIFY_SMS_DRY_RUN`, `NOTIFY_PUSH_DRY_RUN` (the last two default to true outside production and are new in `.env.example`), `MAILJET_*`, `TERMII_*`, `FCM_*`. Two small platform additions: `ModuleContext` now carries `config` and `logger` (a module has no other way to see a tuning variable), and `providerRequest` sends a string body verbatim (FCM's OAuth2 token exchange is form-encoded). Seven findings from the whole-branch review were fixed: a missing provider credential now dead-letters instead of recording `SENT` (a delivery record that lies about an OTP is worse than none), with a production boot check that names the variable; a send job that finds no committed row throws so BullMQ's backoff retries it in milliseconds, instead of returning quietly and leaving the user to the once-a-minute sweep; `releaseStuck` judges a `FAILED` row on `last_attempt_at`, not `queued_at`, so it no longer adds a second job alongside a live retry chain, and it is bounded by a `LIMIT`; `markSent`/`markFailed`/`markDeadLettered` write back only while the caller still holds the claim, so a stalled worker cannot drag a delivered message back to `FAILED`; a disabled or deleted mapping row no longer switches off a security-critical send; a template that cannot be rendered dead-letters its own channel instead of rolling back the whole fan-out; and `WHATSAPP`/`VOICE` raise rather than quietly going out as plain SMS.
- **Deferred:** **quiet hours** — M11 names preferences and the per-user cap as the only gates on a send and specifies no time-of-day window, and a quiet-hours rule that deferred a security message would be exactly the silent suppression D2 forbids; `decideDelivery` is pure and takes everything as arguments, so M17 (T-048) can add the rule when it decides one. The admin endpoints of M11 §7 (dead-letter list, manual retry, `PUT /admin/notification-templates/:key`) need the RBAC catalogue (T-033) and the admin action log. `WHATSAPP` and `VOICE` are in the enum and route to the SMS queue (so the dry-run gate covers them) but have no adapter: `deliver()` raises `UnrecoverableError` rather than delivering one as an SMS the user did not choose. Email is plain text (`TextPart`); rich templates are copy authoring, M17's. `NOTIFY_QUEUE_ENABLED` is in `.env.example` but deliberately unimplemented — a flag that silently stops every notification is worse than a queue that is visibly down. Socket push for the IN_APP feed is T-027's: the row plus `notify.notification.sent` are the durable half, and the gateway subscribes. No `shared-types` wire schemas or `api-client` hooks for the feed and preferences (the web ticket that renders them owns the client contract). FCM's access token is cached per process, not shared; invalid device tokens are reported in the log, not retired (M1 owns `devices.push_token`). Delivery webhooks (`DELIVERED`, `delivered_at`) are unused: no provider callback is wired. `notifications` rows are never pruned — the append-only trigger on the attempt history means the cascade cannot run, so whichever ticket adds retention owns that, and it should also redact `rendered_body` for `SECURITY` rows, which today keeps every OTP ever sent readable indefinitely. The per-user cap is read-then-charge, so N worker processes can admit up to N extra in a window (the safe direction, and the comment says so), and it buckets on event time, so a replayed backlog charges a window that has already closed. Email has no dry-run flag of its own: it relies on `MAILJET_SANDBOX` (forced to `true` for the local target by `pnpm env:backend`) and, since the review, on a missing credential dead-lettering rather than pretending to send — `NOTIFY_EMAIL_DRY_RUN` would be the symmetric fix. `queued_at` comes from the database clock while `sent_at` and the sweep's cutoffs come from the app clock.

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
