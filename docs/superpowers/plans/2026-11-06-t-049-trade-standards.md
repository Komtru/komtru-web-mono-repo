# T-049 Trade Standards by category plan

Scope: `apps/backend-api/src/modules/config/**`, one migration (0034), tests. No fee field exists in a standard.

1. Schema (`config`): `trade_categories (id, code, name, active)` and append-only `trade_standards`, one immutable
   row per version (`id` is the version id a trade snapshots; `unique (category_id, version_number)`). The current
   standard is the highest version number. The append-only trigger rides in the same migration file.
2. Domain: standard shape (inspection window hours, item-spec fields, proof-media rules, IMEI verification,
   delivery deadline days), validation (IMEI verification needs a `serial_imei` field, no fee-like field keys),
   `resolveWindowExtension` (buyer may only lengthen, capped by `trades.inspection_window_max_extension_hours`),
   `validateItemSpec` for trade creation.
3. Services: `publishStandard` (one transaction: new version row holding reason and author, identity audit row,
   outbox event `config.trade_standard.changed`; an identical standard writes nothing), reads by category and by
   version id, `checkBuyerWindowChange` using the accessor for the cap, idempotent seed of Electronics and Fashion v1.
4. HTTP: public `GET /config/trade-standards`, `GET /config/trade-standards/:categoryCode`,
   `GET /config/trade-standards/versions/:id`; STAFF `GET /admin/config/trade-standards` (`config.view`) and
   `PUT /admin/config/trade-standards/:categoryCode` (`config.manage`, reason required).
5. Test first: domain unit tests, route table tests, infra tests for versioning, snapshot read, seed, audit, outbox.

## Decisions

- The version row is the change record (reason, author, time); `config_change_log` has a CHECK limiting targets to
  SETTING and FLAG, so it is not widened here.
- Seed values below are placeholders (no spec states them): see the open questions in the run report.
- Window cap: `trades.inspection_window_max_extension_hours` (seeded 48) limits the extension over the standard
  window of the version the trade snapshotted, so repeated requests cannot creep past it.
- Both category lists are paged (route invariant) even though there are two categories.

## Owner decisions pending

- **Seed values** (placeholders, no spec states them): 48h window and 7-day delivery deadline for both
  categories; Electronics needs 4 photos plus a video, Fashion 3 photos and no video.
- **Caching (1):** an error response is `no-store`; `Cache-Control` is set only after a successful lookup.
- **Caching (2):** the "current" reads (`GET /config/trade-standards[/:categoryCode]`) are `no-cache` with an
  ETag on the version id(s) and answer 304 to a matching `If-None-Match`, so a new version is visible at once.
  The by-id route stays immutable. **Trade creation must call `getCurrentStandard` in-process** (never the HTTP
  route) and store the returned `versionId`.
- **Hardening:** item-spec `label` is fee-guarded as well as `key`; `serial_imei` must be `required` when IMEI
  verification is on; a requested window above int32 is refused; the cap setting is bounded at 336 hours.
