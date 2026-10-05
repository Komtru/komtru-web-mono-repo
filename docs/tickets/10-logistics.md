# Epic 10 — Logistics companies (m2 build spec)

Spec: `docs/specs/m2-logistics-module-spec.md`. Its decisions stand: login-is-acceptance, LINKED/PENDING invite outcomes, one active company per person, no pricing of any kind for courier companies, self-arranged shipping permanent.

---

### T-085 — Logistics schema and Park seed

- **Touches:** `src/modules/logistics/infrastructure/postgres/**`, migration `logistics_*`
- **Depends on:** T-021
- **Acceptance criteria:**
  - `logistics_companies` (+ `is_default`, partial unique index allowing at most one default), `logistics_company_members` with both m2 partial unique indexes (`active_user_uidx`, `company_user_live_uidx`), `logistics_member_invitations` (hashed lookup, encrypted contact), `logistics_packages` with a partial unique index allowing at most one non-`REJECTED` package per trade (m2 §6.1), append-only `logistics_package_status_events`.
  - Seed migration inserts Park as `ENABLED`, `is_default = true`.
  - Concurrency tests: two simultaneous activations for one user produce exactly one `ACTIVE` row (`409 ALREADY_HAS_ACTIVE_COMPANY`); a second default company is rejected.
  - No price, rate or quote column exists (m2 §11; a schema test asserts it).

### T-086 — Logistics auth, companies and members

- **Touches:** `identity` (`POST /auth/logistics/login`, principal membership), `logistics/services/{company,companyMember,memberInvitation}.service.ts`, `logistics/http/**`
- **Depends on:** T-085, T-031, T-037, T-038
- **Acceptance criteria:**
  - `POST /auth/logistics/login` mirrors staff login structure; requires an `INVITED` or `ACTIVE` membership, otherwise `403 NO_LOGISTICS_ACCESS`; first successful login flips `INVITED` to `ACTIVE` (login is acceptance).
  - Principal carries `companyMembership` re-resolved every request; portal routes derive `companyId` from it and never from the request.
  - Admin endpoints (m2 §5a) behind `logistics.manage`; portal member endpoints (m2 §5b) with ADMIN/OPERATOR checks; invite returns `{ outcome: 'LINKED', member }` or `{ outcome: 'PENDING', invitation }`; pending invitations materialise on `identity.email.verified` / `identity.phone.verified`.
  - `409 LAST_ADMIN` when removing or demoting the last admin; removal never touches the `users` row.
  - Invitation notifications are sent through `notify` (closes m2 §13.5).
  - Scope isolation tests per m2 §15.

### T-087 — Package pipeline and ship-to-company

- **Touches:** `logistics/domain/package.ts`, `logistics/services/package.service.ts`, `trades` ship-step integration
- **Depends on:** T-086, T-064
- **Acceptance criteria:**
  - `POST /trades/:code/ship/company` creates a `REQUESTED` package; trade fulfilment substate `AWAITING_SHIPMENT`.
  - Portal endpoints accept, reject (reason required), advance (`PICKED_UP` → `PACKAGED` → `SHIPPED`, tracking number required at `SHIPPED`), deliver; every out-of-order jump returns 409 (tests for each stage).
  - Rejection writes `trade_activity`, notifies the seller and returns them to the ship-step choices (company or self-arranged).
  - `SHIPPED` moves the trade to `SHIPPED`; `DELIVERED` publishes `logistics.package.delivered` in the shared delivery-signal shape (design §7.5) with source `PARTNER_PORTAL`.
  - Admin package list and detail with status history (m2 §5a), filters by status, company and date range, paginated.
