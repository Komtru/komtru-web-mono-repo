# T-042 plan: saved delivery addresses

Ticket: `docs/tickets/03-identity.md`, T-042. Depends on T-030 (identity schema) and T-046 (geo catalog).

## Shape

- Table `identity.user_addresses` (migration `0038_identity_addresses`): label, recipient name, recipient phone (E.164 CHECK), street line, landmark, `state_id` and `city_id` (soft references into `geo`, no cross-schema FK, the same way `geo.city_requests.requested_by_user_id` points at identity), `is_default`, `archived_at`.
- Partial unique index `user_addresses_one_default` on `(user_id) WHERE is_default`; CHECK that an archived row is never the default; a `BEFORE DELETE` trigger (`KT002`, as geo's) plus `REVOKE DELETE FROM komtru_app`, because trades snapshot addresses.
- `GET /me/addresses` (cursor, default first then newest), `POST /me/addresses` (201, idempotency key), `PATCH /me/addresses/:id`, `POST /me/addresses/:id/archive`, `POST /me/addresses/:id/default`.
- `hasUsableAddress(db, userId)` exported from the identity barrel: true when the user holds a non-archived address whose city is still active (a deactivated city cannot take a new trade).

## Rules and judgement calls

- City must exist, belong to the chosen state and be active, else 422 with a `cityId` field error. Checked through geo's exported `getCitiesByIds`, on create and whenever a PATCH changes state or city (a label edit must not fail because the city was deactivated since).
- Phone goes through `normalisePhone` (Nigeria default), stored as E.164; unparseable is 422.
- Cap of 20 non-archived addresses per user (`MAX_ADDRESSES_PER_USER` in shared-types), 409 `ADDRESS_LIMIT_REACHED`. Archived rows do not count.
- Every write for one user runs in one transaction behind `pg_advisory_xact_lock` on the user, so the count, the first-address-becomes-default rule and make-default cannot race; the partial unique index is the backstop.
- First address becomes default. `makeDefault: true` on create moves the default. Archiving the default promotes the newest remaining address (and emits a default-changed event); archiving twice is a no-op. Archived addresses cannot be edited or made default (409). Another user's id is a 404, never a 403.
- PII: phone, recipient name, street and landmark never go into events, audit metadata or log lines. Events carry ids and changed field names only; audit metadata the same. The route layer logs no bodies. The idempotency record for POST keeps the response for 24 hours in the same database, which is accepted.

## Steps (test first, one commit each)

1. shared-types: address schemas, cap, `ADDRESS_LIMIT_REACHED` problem code.
2. Schema, migration 0038, lock and invariants, census test.
3. Address service, events, audit actions, `hasUsableAddress` (unit tests for the pure rules, integration tests for the service).
4. Controller, routes, validation, wiring in `createIdentityAuth`; route tests.
5. api-client endpoints and React hooks.
6. Ticket status line, full verification.
