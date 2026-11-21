# F-065 — Logistics companies, teams and the partner portal

Absorbs T-085, T-086, T-160, T-161. Spec: `docs/specs/m2-logistics-module-spec.md` (its decisions
stand: login-is-acceptance, LINKED/PENDING invite outcomes, one active company per person, no
pricing of any kind).

## Shape

The logistics module is new (`apps/backend-api/src/modules/logistics`). It imports identity through
identity's barrel; identity never imports it. The registry (`src/modules/index.ts`) wires the two
together through two ports identity already half-declared:

- `companyMembership(db, userId)` — the principal's membership, re-resolved every request;
- `logisticsAccess` — `eligible(tx, userId)` before a challenge or session is issued, and
  `acceptOnLogin(tx, userId)` inside the session's own transaction (login is acceptance).

## Steps (each ends green and committed)

1. **T-085 schema + migration 0057.** `logistics` pgSchema: `logistics_companies` (`is_default`,
   one-default partial unique index), `logistics_company_members` (`active_user_uidx`,
   `company_user_live_uidx`), `logistics_member_invitations` (HMAC lookup hash, masked, sealed
   contact; one PENDING per company and address), `logistics_packages` (one non-`REJECTED` package
   per trade), append-only `logistics_package_status_events`. Custom SQL in the same migration:
   Park seeded `ENABLED`, `is_default = true`; append-only trigger. Unit test: no
   price/rate/quote/fee/amount/cost column exists. Int tests (orchestrator runs them): the indexes,
   the concurrent-activation race, the second default.
2. **Domain.** `membership.ts` (`canManageMembers`, `canTransitionMember`, `wouldOrphanCompany`),
   `contact.ts` (normalise, mask, classify an invite contact), events. Unit-tested.
3. **Services.** company (onboard, list, update, members), member (invite → LINKED/PENDING, list,
   role change / removal with `409 LAST_ADMIN` under a company row lock), invitation (list, cancel,
   materialise on `identity.email.verified` / `identity.phone.verified`), access (eligible,
   acceptOnLogin, membership). Unique violations map to `409 ALREADY_HAS_ACTIVE_COMPANY` /
   `409 ALREADY_A_MEMBER` / `409 ALREADY_INVITED`.
4. **Identity.** `LOGISTICS` through `login`, `issueMfaToken`, `completeMfaLogin`,
   `mfaSubjectHash` (own HMAC domain) and `resolveMfaToken`. `POST /auth/logistics/login` and
   `POST /auth/logistics/mfa/verify`, rate-limited like staff login. `403 NO_LOGISTICS_ACCESS` only
   once the password is proved (so it cannot be used to enumerate accounts).
5. **HTTP.** Admin (`STAFF` + `logistics.manage`): `POST/GET /admin/logistics/companies`,
   `PATCH /admin/logistics/companies/:id`, `GET /admin/logistics/companies/:id/members`. Portal
   (`LOGISTICS`): `GET /logistics/me`, `POST/GET /logistics/members`, `PATCH /logistics/members/:id`,
   `GET /logistics/invitations`, `DELETE /logistics/invitations/:id`. `companyId` comes from the
   principal only; no portal schema accepts one.
6. **Notify.** `logistics.member.invited` → template `logistics.member.invited` (in-app + email) to
   the invitee's user. A PENDING invitee has no user yet, so their notification fires when the
   invitation materialises into a membership.
7. **Registry wiring + scope isolation tests.**
8. **T-160 portal scaffold + login** in `apps/logistics-ops` (Next.js, `@komtru/app-kit`,
   `ui-kit` console shell). `NO_LOGISTICS_ACCESS` copy distinct from bad credentials; Park members
   redirected to the Park app.
9. **T-161 team screen.** Invite with two success states, roster with both pending kinds, role
   change and removal, `LAST_ADMIN` → "Promote someone else first", admin controls hidden for
   operators.
10. **Visual capture** under `docs/ui-review/T-160/` and `T-161/`.

## Out of scope

- T-087's package service and ship-to-company; only the package tables land here.
- The logistics-ops Vercel project and DNS record.
