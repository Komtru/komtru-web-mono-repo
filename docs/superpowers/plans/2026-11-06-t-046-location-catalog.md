# T-046 Location catalog: implementation plan

Ticket: `docs/tickets/04-files-notify-config.md` (T-046). Design: platform design section 7.8, open decisions Q16 (seed list, owner reviews before merge) and Q17 (dropdowns list every active catalog city).

## Shape

A new `geo` module under `apps/backend-api/src/modules/geo`, modelled on `config` (T-048): defineModule, a Redis-cached read side with invalidation, an admin write path that is one transaction holding the row, the admin action row (identity's `writeAudit`) and the outbox event.

### Tables (Postgres schema `geo`)

- `states`: `id` uuid, `code` (ISO 3166-2:NG suffix, unique), `name`, `normalised_name` (unique). 36 states plus the FCT, seeded.
- `cities`: `id`, `state_id` FK, `name`, `normalised_name`, `aliases text[]` (normalised search keys), `active`, `seed_key` (nullable unique: the seed inserts a seeded city once and never again, so a renamed or deactivated city is not resurrected by the next deploy), timestamps. **Unique (state_id, normalised_name).**
- `city_requests`: `id`, `requested_by_user_id` (soft uuid), `state_id` FK, `city_name` (as typed), `normalised_name`, `status` (`PENDING`, `ADDED`, `MERGED`, `REJECTED`), `resolved_city_id` FK, `decided_by_admin_id`, `decision_reason`, `decided_at`, `created_at`. Checks tie the decision columns to the status. Partial unique on (requester, state, normalised name) while `PENDING`, so a double tap is one request.

Normalisation is one pure function in `shared-types` (`normaliseCityName`): NFKD, strip marks, lower-case, non-alphanumerics to single spaces. Backend and frontends share it.

### Never delete

There is no DELETE route and no delete in any repository: a city leaves the dropdowns by `active = false` and stays readable by id (`GET /geo/cities/:cityId` and the module barrel's `getCitiesByIds`, both returning inactive cities) so old addresses, hubs and trades still resolve. Migration phase adds a custom migration with a `BEFORE DELETE` trigger on `geo.states` and `geo.cities` (TRUNCATE is not covered, which the test harness needs), so the rule holds against a writer that is not this module.

### Routes

Public (PUBLIC scope, per-IP budget, cursor paginated, Redis cached):

- `GET /geo/states`
- `GET /geo/states/:stateId/cities` (active only)
- `GET /geo/cities?q=&stateId=` (prefix on name, or on any alias; active only)
- `GET /geo/cities/:cityId` (one city, active or not)

Consumer: `POST /geo/city-requests` (state plus typed name). A name that already matches an active city in that state is a 409 carrying the `cityId`, so the form can select it instead.

Staff, all `geo.manage`, a reason on every write (400 without, as config does):

- `GET /admin/geo/states` (with city counts), `GET /admin/geo/states/:stateId/cities` (includes inactive)
- `POST /admin/geo/cities`, `PATCH /admin/geo/cities/:id` (rename and aliases; the old name becomes an alias), `POST /admin/geo/cities/:id/deactivate`, `POST /admin/geo/cities/:id/activate`
- `GET /admin/geo/city-requests?status=` (with `requesterCount`: pending requests sharing the same state and name), `POST .../:id/add`, `POST .../:id/merge` (target city must be active in the same state; the typed name is kept as an alias), `POST .../:id/reject`

Deciding a request decides every still-pending request for the same state and name in the same transaction, so a city fifty people asked for is added once and all fifty are told.

Page size: the platform caps cursor pages at 100 (`cursorPageRequestSchema`) and a route cannot raise it, so the api-client hooks ask for 100 and follow `nextCursor`. 37 states and every seeded state's cities fit in one request. Raising the cap per route is a platform change and is deferred.

### Cache

Keys carry a catalog version: `geo:v<N>:<what>`. A change bumps `geo:version` (INCR) after commit, which retires every key at once, typeahead included, with no key enumeration. The reader reads the version before it queries Postgres, so a read racing a commit can only fill a key nobody will read again. The event subscriber `geo.on-catalog-changed` bumps it again from the worker for other instances and non-route writers; it throws on a Redis failure so the outbox redelivers. Keys also expire (10 minutes). A Redis outage costs a query and nothing else.

### Events and notification

- `geo.catalog.changed` (city added, renamed, aliases changed, deactivated, activated): drives cache invalidation.
- `geo.city_request.decided`: `{requestId, requesterUserId, status, stateName, requestedName, cityName, reason}`. Notify binds it to template `geo.city_request.decided` (IN_APP and EMAIL, category ACCOUNT, not security critical); the copy differs by outcome through a pre-rendered `outcomeLine` variable, since templates have no conditionals (M11 D5).

Notify's catalogue tests asserted the exact identity set; they now filter to `identity.*` so each later ticket can add templates without editing them.

### Admin action log

Every staff write calls `writeAudit` with `ADMIN_GEO_*` actions in the same transaction, metadata holding ids, old and new names, and the reason.

### Permission: `geo.manage`

T-037 already put `geo.manage` in the RBAC catalogue and matrix (SUPER_ADMIN and OPERATIONS_ADMIN, "no named holder in any spec"). T-046 keeps that grant unchanged: OPERATIONS_ADMIN is the TrustOps role that registers hubs and adds cities inline (T-107 and operations-app OP-08), and SUPER_ADMIN is the break-glass superset. KYC_ANALYST and PARK_OPERATIONS are not granted: the catalogue feeds every address, hub and trade, so changing it stays with the narrowest role that runs day-to-day operations. No catalogue change, no matrix-count change. Owner can widen later in the catalogue and the matrix test together.

### Seed

`src/modules/geo/seed/nigeria-locations.seed.ts`, the one file the owner reviews (Q16): 36 states plus the FCT, each with its capital and the major commercial cities. Insert-only through `seed_key`, run by `pnpm db:migrate` / `pnpm db:seed` via the module's `seed` hook and listed in `moduleSeeds`.

### api-client

`src/geo.ts` (isomorphic): endpoints `listStates`, `listStateCities`, `searchCities`, `getCity`, `submitCityRequest`. `src/react/geo.ts`: `ApiClientProvider`/`useApiClient`, `useStates()` and `useCities(stateId)` (TanStack Query, fetch all pages at limit 100, long `staleTime`, `useCities` disabled until a state is chosen), plus `geoKeys`.

## Test-first order

1. shared-types `geo.ts` (+ tests): normaliser, schemas.
2. Domain unit tests: seed integrity (37 states, unique normalised names per state, capital present for every state, every alias unique within its state), cursor/typeahead query builder, request decision rules.
3. Cache unit tests with a fake Redis (version bump retires keys, Redis failure falls through).
4. Service and route tests: route table (scopes, permission `geo.manage`, invariants), notification binding variables.
5. Integration tests (written, not run until migration 0036): unique index, concurrent adds, listing, typeahead by prefix and alias, inactive hidden but readable, request lifecycle for add, merge and reject, group decision, audit rows, outbox events, cache invalidation.
6. api-client endpoints and hooks tests.

## Migration sequencing

Another ticket is adding migration 0035. This branch adds nothing under `apps/backend-api/drizzle/` and does not generate. When everything else is green the implementer stops at READY FOR MIGRATION, then merges main, generates 0036 (plus the custom no-delete trigger migration), runs the integration tests and migration safety.
