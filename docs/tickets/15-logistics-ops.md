# Epic 15 — `logistics-ops` (logistics.komtru.com, courier POC portal)

The reference HTML has no screens for this portal. Screens follow m2 §8 and are built with `ui-kit`'s desktop console shell. Same definition of done as Epic 13, except the visual check is design-system conformance (tokens, shells and primitives used correctly) instead of screenshot-vs-reference.

---

### T-160 — Portal scaffold and login

- **Depends on:** T-017, T-086, T-190
- **Acceptance criteria:** login hits `POST /auth/logistics/login`; `403 NO_LOGISTICS_ACCESS` shows "This account isn't attached to a logistics company", distinct from invalid credentials; the login screen doubles as invitation acceptance (no token-based accept page); `LOGISTICS` scope enforced by middleware; a Park Agent who logs in here is redirected to `park.komtru.com`.

### T-161 — Team management

- **Depends on:** T-160, T-190
- **Acceptance criteria:** invite with two distinct success states ("Added — they can log in now" for `LINKED`, "Pending — they get access once they sign up with this email or phone" for `PENDING`); roster shows both pending kinds distinctly; role change and removal; `409 LAST_ADMIN` explained as "Promote someone else first"; admin-only controls hidden for operators.

### T-162 — Packages

- **Depends on:** T-160, T-087, T-190
- **Acceptance criteria:** package list filterable by status with accept and reject prominent on `REQUESTED`; detail with the full pipeline, advance action, tracking number required at `SHIPPED`, rejection reason required; realtime updates; every action idempotent.
