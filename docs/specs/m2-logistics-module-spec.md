# Kumtru Logistics Module (M2) — Portal + API Build Spec

**Audience:** the intern engineering team building this out. **Status, updated 2026-08-30:** §2 (Identity &
access model) and the company/member portions of §3, §4, and §5a/§5b are **already built** — see the "✅
BUILT" markers throughout. They live on branch `feat/m2-logistics-identity` in `backend-apis` (based on
`development`, one commit, not yet merged) — pull that branch rather than rebuilding any of it. Everything
else in this document (the package/pickup pipeline, all three frontends) is genuinely open and is the
interns' actual scope. Two sections are additionally marked "Needs sign-off before anyone touches it" — those
are changes to the already-built, already-in-production-use Trade Management module (M7), and should not be
started without Emmanuel explicitly approving the approach first.

**Read this before building the portal's invite/login screens:** the built identity/company layer deviates
from what earlier drafts of this spec assumed in a few real, deliberate ways — no separate invitation
"accept" step, no account auto-creation, no notification delivery yet. All three are covered where relevant
below (§2, §5a/§5b, §8) — don't rebuild against the original assumption in your head, read the current text.

**How to use this document:** it's meant to be self-contained — you shouldn't need to go spelunking through
other planning docs to understand what to build. Where a decision traces back to something Emmanuel said
directly, it's quoted. Where something is this document's own recommendation rather than a confirmed
decision, it's labeled as such.

---

## 0. What this module is, in one paragraph

Kumtru is an escrow marketplace: a seller creates a trade, a buyer funds it, the seller ships the goods, and
once the buyer confirms receipt the platform releases the held funds. Today, "ships the goods" is entirely
manual — the seller types in a courier name and a tracking number themselves, and nothing verifies either.
This module adds an alternative: admin-onboarded logistics companies that sellers can hand a shipment to
directly through the platform, with a real accept/reject step, a real status pipeline, and real tracking
numbers attached by the company handling the package. The old manual flow does **not** go away — it stays a
permanent, first-class option a seller can always pick instead, whether or not any logistics company exists.

---

## 1. Glossary

- **Logistics company** — a courier/delivery business onboarded by a Kumtru admin. Lives in a new
  `logistics_companies` table.
- **POC (point of contact)** — a person who works for a logistics company and can log into the logistics
  portal on that company's behalf. A POC is a Kumtru user like any other — see §2, this is important and not
  the obvious choice.
- **Company Admin** (POC role) — a POC who can manage the company's other POCs and settings.
- **Operator** (POC role) — a POC who handles pickup requests, packaging, and tracking numbers, but can't
  manage other POCs.
- **Package (request)** — the record created when a seller hands a trade's shipment to a specific logistics
  company. One package request per trade, and only for company-handled trades — self-arranged shipping does
  **not** create a package request (see §7).
- **Self-arranged shipping** — the existing, already-built flow where the seller manually enters a courier
  name and tracking number on the trade itself, with no logistics company involved. Permanent, not a
  fallback-only mode.
- **Capability** — Kumtru's account model: one `users` row per person, with capabilities layered on top
  (buyer/seller are implicit, staff is a role grant, and — per this spec — logistics-POC is a company
  membership). Never a second account or a second signup for the same person. See §2.

---

## 2. Identity & access model — ✅ BUILT (`feat/m2-logistics-identity`) — read this before touching auth code anyway

Kumtru's account model, confirmed directly by Emmanuel: **one `users` table for everyone.** A person who's
already a customer, or already staff, or both, doesn't get a second account when they also become a
logistics POC — the same account just gains a capability. Quoting Emmanuel directly, from the conversation
that settled this:

> "the reason I want all users to share the same users table is so that if someone is already added as a
> staff, they should still be able to use the customer part in their daily life... I want that same thing
> for the logistics-user... just add a capability for logistics... and when they attempt to login to the
> logistics portal we know they have that ability, and if they don't, we bounce the login request."

This already has a precedent in the codebase for exactly this kind of thing: **staff access is not a
separate identity space either.** A staff member's session carries a `scp: 'STAFF'` claim instead of
`scp: 'CONSUMER'`, on the exact same `users`/`sessions` rows a buyer/seller uses, and there's a **separate
login endpoint** for it — `POST /auth/staff/login` is not a flag on `POST /auth/login`, it's its own route,
with a code comment explicitly calling this out as a deliberate control ("Staff login is a SEPARATE
endpoint, not a flag (control C2)"). **Logistics follows the same pattern as a third scope, not a new
mechanism:**

**All of the below is already built, on `feat/m2-logistics-identity`. Not a to-do list — read it to know what
you're working against.**

- `'LOGISTICS'` is now a third value on the `SessionScope` DB enum (`'CONSUMER' | 'STAFF' | 'LOGISTICS'`),
  migrated in. The hardcoded scope check in `src/modules/identity/domain/session/tokens.ts` accepts it.
- `POST /auth/logistics/login` exists, mirroring `POST /auth/staff/login`'s structure exactly (same
  credential-verification logic as staff/consumer login). The eligibility check it runs before issuing a
  `LOGISTICS`-scoped session: the caller must have an **active row in `logistics_company_members`** (§3). No
  active membership → `403 NO_LOGISTICS_ACCESS` — the credentials can be entirely valid for the person's
  regular Kumtru account, this is specifically about portal eligibility.
- `principal.service.ts`'s `resolvePrincipal` attaches the caller's company membership (`companyId` + `role`)
  to `Principal.companyMembership` for a `LOGISTICS`-scoped token, re-resolved on every request (never cached
  on the token itself — a role change or removal takes effect on the caller's very next request, not just
  their next login).
- Route-level gating: `adminLogisticsRouter` (§5a) requires `scope: 'STAFF'` **plus** a new `logistics.manage`
  permission, applied at the router level via `.use(authenticate(...))` so every route mounted under it is
  correctly scoped by construction. `logisticsRouter` (§5b) requires `scope: 'LOGISTICS'` at the router level;
  `ADMIN`-vs-`OPERATOR` authorization within that is a controller-level check (a logistics POC role is not in
  identity's RBAC catalogue at all — it's a separate, smaller authorization model, not a staff permission).

**Invitation model — REVISED 2026-08-30, corrected from what `feat/m2-logistics-identity` originally
shipped, and now ✅ BUILT (commit `0e6f007` on the same branch). Read this before building the portal's invite
UI (§8).**

The original build required the invited email/phone to already belong to an existing, verified Kumtru
account, 404-ing (`POC_ACCOUNT_NOT_FOUND`) otherwise. **Emmanuel corrected this directly: "if the account
does not exist, make it and link it to logistics immediately... if the person tries to login on the customer
app, it should still let them."** Two requirements follow from that: inviting someone must never dead-end
just because they haven't signed up yet, and whatever account results must be a completely ordinary Kumtru
account, usable on `web-app-ui` exactly like any other — not a logistics-only stub.

The literal reading — insert a `users` row the instant an admin types an email — is deliberately **not**
what gets built, for the same reason this codebase never does that anywhere else: `staffInvitation.service.ts`
doesn't create a `users` row at invite time either, precisely because creating an account from an unverified
claim of an email/phone is a spoofing vector (anyone could "invite" a stranger's real address into an account
that person never asked for). Staff invitations solve this by storing the invite as its own record and only
materializing the `users` row at acceptance, gated on an OTP proving the invitee actually controls that
address. **This module now follows the identical shape, adapted so it still satisfies both of Emmanuel's
requirements in full:**

- Looking up an existing verified account (`findUserIdByVerifiedEmail`/`findUserIdByVerifiedPhone`) is
  unchanged, and unchanged for the case where one is found: a `logistics_company_members` row is created
  immediately, exactly as already built.
- **New, when no existing verified account is found:** create a `logistics_member_invitations` row instead
  (a new table, mirroring `staffInvitations`'s shape — hashed/masked/encrypted email or phone, `companyId`,
  `role`, `invitedByUserId`, `status: 'PENDING'`, `expiresAt`) rather than 404-ing. No `users` row yet, no
  `logistics_company_members` row yet.
- **New:** the logistics module subscribes to identity's existing `identity.email.verified` /
  `identity.phone.verified` events (already exported via `subscribeToIdentityEvents` — no identity-side
  change needed, these events exist today). When one fires, check for a matching `PENDING`
  `logistics_member_invitations` row by the same hashed-lookup technique `staffInvitations` uses. If found:
  in one transaction, create the real `logistics_company_members` row (`status: 'INVITED'`, the now-known
  `userId`) and mark the invitation `ACCEPTED`.
- Net effect: the person just signs up (or verifies an email/phone on an existing account) through the
  **ordinary** Kumtru registration path — on `web-app-ui`, or wherever — and their logistics access appears
  automatically, no separate step, no admin follow-up, no dead end. This satisfies "make it and link it
  immediately" as immediately as it can safely happen, and satisfies "still let them log in on the customer
  app" exactly, since ordinary signup on the customer app IS the mechanism that completes it.
- `POC_ACCOUNT_NOT_FOUND` is **removed**. Inviting/onboarding any email or phone now always succeeds. The
  built response shape is `{ outcome: 'LINKED', member }` (matched an existing account) or
  `{ outcome: 'PENDING', invitation }` (no account existed yet) — build the portal/admin UI's two-state
  display (§8/§9) against this exact shape, not a single flat response.
- **Login-is-acceptance is unchanged and still applies uniformly** on top of all this: whether a
  `logistics_company_members` row was created immediately (existing account) or materialized later via the
  event listener above (new account), it still sits at `INVITED` until that person's first successful
  `POST /auth/logistics/login`, which is what flips it to `ACTIVE`.

**Notification delivery is still NOT built** (unchanged from the original note) — inviting someone, whether
they already have an account or not, publishes an event nobody consumes yet. Until M11 wiring exists, the
inviter still needs to tell the person directly, out of band, that they now have (or will soon have, once
they sign up) logistics access.

**What this means for the portal itself:** the logistics portal is a genuinely separate frontend
surface/login page (see §8) — but it is authenticating the *same* Kumtru account a person might also use to
buy and sell on `web-app-ui`, whether that account pre-existed the invite or was created by the invitee's own
ordinary signup afterward. Don't build a separate signup flow for POCs, and don't build a token-based
invitation-acceptance page in the logistics portal itself — acceptance happens through identity's existing
signup/verification path, not a new one.

---

## 3. Data model

### `logistics_companies` — ✅ BUILT

| column | type | notes |
|---|---|---|
| `id` | uuid, PK | |
| `name` | text, not null | |
| `status` | enum `ENABLED` \| `DISABLED` | default `ENABLED`. This is the flag the seller-facing dropdown will check (§6, not yet built) — disabling a company hides it from new package requests without deleting history. Indexed. |
| `createdByUserId` | uuid, **soft ref** to `identity.users(id)`, not a hard FK | the admin who onboarded it — see the note below on why cross-schema refs in this module are soft |
| `createdAt` / `updatedAt` | timestamptz | |

Lives in its own `logistics` Postgres schema (not `public`), same convention `identity`/`trades` already use.
`companyId` → `logistics_companies` is a real, hard FK (same-schema); any pointer to `identity.users` is a
**soft** reference (a plain `uuid` column, no `REFERENCES`) — this is deliberate, matching how other modules
in this codebase already avoid hard cross-schema FKs to `identity`, not an oversight.

### `logistics_company_members` — ✅ BUILT

One row per (person, company) relationship, historical rows kept rather than deleted.

| column | type | notes |
|---|---|---|
| `id` | uuid, PK | |
| `companyId` | uuid, hard FK → `logistics_companies`, `onDelete: cascade` | |
| `userId` | uuid, **soft ref** to `identity.users(id)` | |
| `role` | enum `ADMIN` \| `OPERATOR` | |
| `status` | enum `INVITED` \| `ACTIVE` \| `REMOVED` | see §2 for the actual (not staff-invitation-mirrored) lifecycle this drives |
| `invitedByUserId` | uuid, soft ref, nullable | null for the very first POC an admin creates directly during company onboarding — the onboarding admin is instead recorded on `logistics_companies.createdByUserId` |
| `invitedAt` / `acceptedAt` / `removedAt` | timestamptz, nullable | |

**Two partial unique indexes, both built:**

1. `logistics_company_members_active_user_uidx` — on `userId` where `status = 'ACTIVE'`. Enforces "one active
   company per person" (confirmed by Emmanuel: "one company per poc is fine"), allowing a person's full
   history (join, leave, join elsewhere) while guaranteeing at most one active row at a time — enforced by
   Postgres itself, including under a concurrent race, not by a check-then-insert in the service layer. A
   violation surfaces as `409 ALREADY_HAS_ACTIVE_COMPANY`.
2. `logistics_company_members_company_user_live_uidx` — on `(companyId, userId)` where `status IN ('INVITED',
   'ACTIVE')`. A narrower guard: stops a duplicate pending-or-active row at the *same* company for the same
   person (re-inviting someone who's already invited/active there). Does not by itself stop them holding a
   live row at a *different* company — index 1 is what enforces that. A violation surfaces as
   `409 ALREADY_A_MEMBER`.

Removing or demoting a company's last `ADMIN` is blocked with `409 LAST_ADMIN` (a service-layer guard, not a
DB constraint) — not explicitly asked for in earlier drafts of this spec, but without it a company could
permanently lock itself out of managing its own roster.

### `logistics_packages` — not yet built, this is your scope

One row per **company-handled** trade only. Self-arranged trades never get a row here — their shipping data
lives entirely on the `trades` table's existing `courier`/`tracking`/`dispatchedAt`/`deliveredAt` columns
(already built in M7, see §7).

| column | type | notes |
|---|---|---|
| `id` | uuid, PK | |
| `tradeId` | uuid, FK → trades, **unique** | 1:1 with the trade |
| `companyId` | uuid, FK → `logistics_companies`, not null | |
| `requestedByUserId` | uuid, FK → users | the seller |
| `assignedOperatorId` | uuid, FK → users, nullable | which POC is handling it, set on accept or later |
| `status` | enum, see below | |
| `trackingNumber` | text, nullable | set at the `SHIPPED` transition, not before |
| `rejectionReason` | text, nullable | set on `REJECTED` |
| `requestedAt` / `acceptedAt` / `rejectedAt` / `pickedUpAt` / `packagedAt` / `shippedAt` / `deliveredAt` | timestamptz, nullable | one per pipeline stage, set only when that stage is actually reached |

`status` enum: `REQUESTED` → `ACCEPTED` | `REJECTED` → (`ACCEPTED` only) `PICKED_UP` → `PACKAGED` →
`SHIPPED` → `DELIVERED`. Confirmed staged pipeline with timestamps per Emmanuel's explicit answer.

### `logistics_package_status_events` — not yet built, this is your scope

Append-only audit trail, one row per transition — mirrors the `tradeStateChanges` pattern already used in
the trades module (`src/db/schema/trades`). Don't skip this; it's what makes the Packages admin view in
§9 possible and what makes a support/dispute investigation possible later.

| column | type | notes |
|---|---|---|
| `id` | uuid, PK | |
| `packageId` | uuid, FK → `logistics_packages` | |
| `fromStatus` | enum, nullable (null on the initial `REQUESTED` row) | |
| `toStatus` | enum | |
| `actorUserId` | uuid, FK → users, nullable | null for a system-triggered transition, if any exist |
| `note` | text, nullable | e.g. the rejection reason, duplicated here for a stable audit record even if `rejectionReason` on the package row is later edited |
| `createdAt` | timestamptz | |

---

## 4. Backend module layout

`src/modules/logistics/` already exists, on `feat/m2-logistics-identity`. Add to it — don't create a second
module. Current state (✅ built vs. still yours to add):

```
src/modules/logistics/
  domain/
    membership.ts            # ✅ built — canManageCompanyMembers, wouldOrphanCompany (the LAST_ADMIN guard)
    package.ts                #  NOT built — status transition rules (canTransition-style), yours to add
  services/
    company.service.ts        # ✅ built — onboard/list/update a company
    companyMember.service.ts  # ✅ built — invite/list/update/remove a POC; resolveForLogin (§2's
                                #   login-is-acceptance)
    memberInvitation.service.ts # ✅ built — the §2 REVISED fix: creates a pending
                                #   logistics_member_invitations row when no account exists yet, and
                                #   materializes it into a real membership once the invitee's contact gets
                                #   verified (called from identityListener.ts below)
    executor.ts                # ✅ built — small transaction-executor helper the services above share
    package.service.ts        #  NOT built — create/accept/reject/advance a package request, yours to add
  domain/
    contact.ts                 # ✅ built — email/phone normalize/mask, a self-contained mirror of identity's
                                #   own equivalent (not importable across the module boundary)
  http/
    controllers.ts             # ✅ built (company/member) — add package controllers alongside
    routes.ts                  # ✅ built (company/member) — add package routes alongside, same two routers
    validations.ts              # ✅ built (company/member) — add package validation schemas alongside
  infrastructure/
    events.ts                  # ✅ built — publishLogisticsEvent/subscribeToLogisticsEvents, currently carrying
                                #   logistics.company.created/updated and logistics.member.invited/activated/
                                #   role_changed/removed. Add logistics.package.* event types to THIS SAME file.
    identityListener.ts        # ✅ built — subscribes to identity.email.verified/identity.phone.verified via
                                #   subscribeToIdentityEvents and calls memberInvitation.service.ts to
                                #   materialize any matching pending invitation
    contactCrypto.ts           # ✅ built — HMAC lookup hash + envelope encryption for invitation contact
                                #   info, mirroring identity's own crypto primitives (not importable directly)
  bootstrap.ts                 # ✅ built — boot-time wiring, incl. registering identity's LogisticsAccessPort
                                #   and the identityListener subscription; stopLogistics() for shutdown
  index.ts                     # ✅ built — the module's only public export surface; add package exports here too
```

Plain exported functions, no class hierarchy — same convention as every other module in this codebase, and
what's already built follows it. Import anything you need from the company/member layer via the module's own
`index.ts` barrel or directly from `services/company.service.ts` / `companyMember.service.ts` — e.g. to
resolve "what's my company" for a package endpoint, don't re-derive it, the principal already carries
`companyMembership` (§2).

---

## 5. Backend API surface

Three different audiences hit this module. Keep them on separate routers even where the underlying service
call is shared, because the auth requirement is different for each.

### 5a. Admin-facing (operations-app → backend-apis, `scope: 'STAFF'`)

| Method | Path | Status | Purpose |
|---|---|---|---|
| `POST` | `/admin/logistics/companies` | ✅ built | Onboard a company: `{ name, initialPoc: { email or phone } }`. If `initialPoc` matches an existing verified account, creates the company and its first `logistics_company_members` row (role `ADMIN`, status `INVITED`) in one transaction — response `{ outcome: 'LINKED', member }`. Otherwise creates a pending `logistics_member_invitations` row instead — response `{ outcome: 'PENDING', invitation }` — which self-materializes into a real membership once that person signs up and verifies (§2). No `POC_ACCOUNT_NOT_FOUND` 404 anymore. |
| `GET` | `/admin/logistics/companies` | ✅ built | List, with `status` filter, `page`/`limit` pagination. |
| `PATCH` | `/admin/logistics/companies/:id` | ✅ built | Update `name` and/or `status` (enable/disable). |
| `GET` | `/admin/logistics/companies/:id/members` | ✅ built | List a company's POCs and their status, for support visibility. |
| `GET` | `/admin/logistics/packages` | NOT built | Cross-company package list (the Packages admin view, §9) — filter by status, company, date range. Yours to add. |
| `GET` | `/admin/logistics/packages/:id` | NOT built | One package's full detail + its status event history. Yours to add. |

All routes gated by `requirePermission('logistics.manage')` (✅ already added to
`src/modules/identity/domain/rbac/catalog.ts`, granted to `SUPER_ADMIN`, `OPERATIONS_ADMIN`, and
`LOGISTICS_OPERATOR`, with `tests/identity/rbac.test.ts`'s exhaustive-matrix counts already updated) — **you
do not need to touch the RBAC catalogue for the two new package endpoints above**, they reuse the same
permission. Only add a new permission if the package endpoints genuinely need finer-grained access than the
company endpoints do.

### 5b. Logistics-portal-facing (new logistics portal → backend-apis, `scope: 'LOGISTICS'`)

Every endpoint here is implicitly scoped to the caller's own company (resolved from
`req.principal.companyMembership.companyId`, §2 — never accept a `companyId` from the request body/query for
these, it's always derived from the authenticated session, already true for the built endpoints below and
must stay true for the ones you add).

| Method | Path | Status | Purpose | Role required |
|---|---|---|---|---|
| `POST` | `/logistics/members` | ✅ built | Invite another POC to your company. `{ email or phone, role }` — same §2 behavior as §5a's `initialPoc`: `{ outcome: 'LINKED', member }` or `{ outcome: 'PENDING', invitation }`, never a 404. | `ADMIN` |
| `GET` | `/logistics/members` | ✅ built | List your company's POCs, `status` filter. | `ADMIN` or `OPERATOR` |
| `PATCH` | `/logistics/members/:id` | ✅ built | Change a POC's `role`, or remove them (`status: 'REMOVED'`) — never touches the underlying `users` row (directly tested). Blocked with `409 LAST_ADMIN` if it would leave the company with no `ADMIN`. | `ADMIN` |
| `GET` | `/logistics/packages` | NOT built | List package requests for your company, filterable by status. Yours to add. |
| `POST` | `/logistics/packages/:id/accept` | NOT built | Accept a `REQUESTED` package request. Sets `assignedOperatorId` to the caller if not already set. Yours to add. |
| `POST` | `/logistics/packages/:id/reject` | NOT built | Reject it. Body: `{ reason: string }`, required. Yours to add. |
| `POST` | `/logistics/packages/:id/advance` | NOT built | Move to the next pipeline stage (`PICKED_UP` → `PACKAGED` → `SHIPPED`). Body for the `SHIPPED` transition specifically requires `{ trackingNumber: string }` — reject the transition without it. Yours to add. |
| `POST` | `/logistics/packages/:id/deliver` | NOT built | Mark `DELIVERED`. Publishes `logistics.package.delivered` (§7). Yours to add. |

Validate every transition against `domain/package.ts`'s state machine (not yet built — this is yours) — don't
let a client jump straight from `REQUESTED` to `SHIPPED`, reject anything that isn't the next stage in
sequence with a 409, same pattern the trades module already uses for its own `canTransition` check, and the
same pattern `wouldOrphanCompany`/`LAST_ADMIN` above already establishes for this module specifically.

### 5c. Seller-facing (web-app-ui → backend-apis, `scope: 'CONSUMER'`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/me/logistics/companies` | List `ENABLED` companies, for the ship-step dropdown. No auth requirement beyond being logged in — every buyer/seller can see the same list. |
| `POST` | `/trades/:tradeCode/ship/company` | The seller picks a company at the ship step. Body: `{ companyId }`. Creates the `logistics_packages` row (status `REQUESTED`), publishes a pickup-request notification to the company, and triggers the trade-side state change described in §7. |
| `POST` | `/trades/:tradeCode/ship/self` | The existing self-arranged flow — **this already exists**, it's M7's current `markShipped`, not new work. Listed here only so the dropdown's two choices map cleanly to two endpoints in your head. |

---

## 6. Package status pipeline — state machine

```
REQUESTED --accept--> ACCEPTED --pickup--> PICKED_UP --package--> PACKAGED --ship(+tracking#)--> SHIPPED --deliver--> DELIVERED
    |
    +--reject(+reason)--> REJECTED   (terminal for this package; see below for what happens to the trade)
```

**On reject, confirmed by Emmanuel:** "if a logistics company refuses a request, it should bounce back to
the seller to use another vendor and that should get logged in the life cycle of the trade." Concretely:

1. The package row moves to `REJECTED` (terminal — don't reuse it, a retry creates a **new**
   `logistics_packages` row against a different company, since the unique `tradeId` constraint means only
   one row can be non-terminal at a time — either allow multiple rows per trade with only one
   non-terminal/non-rejected at once, or drop the hard uniqueness and instead enforce "at most one row per
   trade with status not in (`REJECTED`)" as a partial unique index, same technique as the one-active-company
   rule in §3).
2. Publish a trade-lifecycle event (however M7 already logs lifecycle events for a trade — it uses
   `tradeStateChanges` for status transitions and `tradeTrustEvents` for a separate trust-signal feed; a
   rejection is neither a status transition nor a trust event exactly, so check with whoever owns the trades
   module which of the two — or a new lightweight "trade activity log" entry — is the right home before
   inventing a third table).
3. The seller is bounced back to the ship-step dropdown to pick again — either a different company, or
   self-arrange (§7 confirms self-arrange is always available, never removed as an option).

---

## 7. Trade module integration — READ CAREFULLY, PART OF THIS IS NOT YOURS TO BUILD ALONE

This is the part of the logistics build that reaches into M7 (Trade Management), which is already built and
in active, ongoing development directly by Emmanuel. **Everything in §7b needs Emmanuel's explicit sign-off
on the approach before it's implemented** — don't treat this document's recommendation as approval.

### 7a. What already exists in M7 that this module should reuse, not duplicate

- The trade row already has `fulfilmentStatus` (enum: `not_started` \| `awaiting_shipment` \| `dispatched` \|
  `delivered` \| `failed`), `courier`, `tracking`, `dispatchedAt`, `deliveredAt` columns. **`awaiting_shipment`
  exists in the enum today but nothing in the codebase currently sets it** — that's a strong signal the
  original schema already anticipated a two-phase ship flow (request → actually shipped) and this module is
  the thing that finally uses it. Don't add a parallel status field to the trade row for "package requested"
  — use the existing, currently-dormant `awaiting_shipment` value.
- Self-arranged shipping already works end to end: `markShipped` (seller-triggered) sets
  `fulfilmentStatus: 'dispatched'`, `courier`, `tracking`, `dispatchedAt`, moves the trade to `IN_PROGRESS`,
  and publishes `delivery.dispatched.requested` and `trade.shipped` events. This module's job is to give a
  **second way** to reach that same state (via a company's pipeline instead of a manual form), not to
  replace it.
- `confirmDelivery` (buyer-triggered, the *only* current path to `FULFILLED`/`COMPLETED`/`SETTLED`) has this
  exact comment in `trade.service.ts` today: *"No separate inspection-window endpoint exists in this batch's
  contract... STUB for M8: the release is requested, not executed."* Its audit row is even written with
  `reason: 'no_inspection_window_in_this_contract'`. That gap is real and is what §7b addresses.
- The trade's own `inspectionPeriod` field (a `text` column, collected at trade creation via a 4-option
  preset dropdown in `start-trade-dialog.tsx` — "24 Hours" / "48 Hours (Recommended)" / "72 Hours" /
  "7 Days") is stored but **never read by any logic today** — it's purely a display string on the trade
  detail page. It's the natural source for the inspection-window duration described below, but as free text
  it can't safely be used to compute a deadline without parsing it. This is called out again in §7b.

### 7b. What needs to change in M7 — needs sign-off before implementation

Confirmed design intent from Emmanuel: "a package created is attached to trade, and so when a package's
status becomes delivered, we just notify the buyer and seller of this event and allow the buyer to close the
trade by marking it received. if after our stipulated inspection window we don't hear back from the buyer,
we auto complete."

Today, "delivered" and "buyer confirms and funds release" are the **same atomic action** (`confirmDelivery`).
The design above requires splitting that into two separate moments — a real-world delivery signal, and a
(possibly later, possibly automatic) confirmation. This document's recommended approach, **not yet approved:**

- Add a new trade status between `IN_PROGRESS` and `FULFILLED` — e.g. `AWAITING_CONFIRMATION` — entered when
  a delivery signal arrives (from this module's `logistics.package.delivered` event for company-shipped
  trades, or from a new self-arranged "mark delivered" action for the self-arranged path — note the
  self-arranged path currently has **no** delivered signal separate from `confirmDelivery` either, so this
  gap exists on both paths, not just the company-shipped one).
- Split today's single `confirmDelivery` into two functions: a `markDelivered` step (sets
  `fulfilmentStatus: 'delivered'`, `deliveredAt`, moves the trade to `AWAITING_CONFIRMATION`, notifies both
  parties, and computes/stores a deadline for the inspection window) and a `confirmReceipt` step (does what
  `confirmDelivery` does today — the `FULFILLED → COMPLETED → SETTLED` chain — callable either by the buyer
  directly or by a scheduled job once the deadline passes).
- The inspection-window deadline needs a real, computable duration — recommend normalizing
  `inspectionPeriod` into a structured value (e.g. an `inspectionWindowHours` integer column, with the four
  existing UI presets mapped to hour counts client-side) rather than parsing the free-text string at
  deadline-computation time. Since nothing reads `inspectionPeriod` today, this is a low-risk moment to make
  that change — it gets much riskier once something depends on the current text format.
- The actual timeout-triggered auto-complete needs a job scheduler. **This codebase does not have one yet**
  — the M8 payments build hit the identical dependency for scheduled payouts (`AUTO_DAILY`/`AUTO_WEEKLY`/
  `AUTO_MONTHLY` payout sweeps) and deliberately built everything around it while leaving the actual
  scheduling for when a scheduler (e.g. BullMQ) lands. Do the same here: build `confirmReceipt` so it's
  callable by a scheduled job later, don't build a bespoke timer for just this feature.

**What this means practically for the interns:** you can and should build everything in §2–§6 now — the
company/POC/package data model, the portal, the admin UI, the accept/reject/tracking pipeline, and the
`logistics.package.delivered` event your module publishes. What you should **not** do without further
instruction is modify `trade.service.ts`'s state machine yourselves — that's Emmanuel's call on timing and
approach, given he's actively working in that file. Publish the event and stop there; treat the trade-side
consumption of it as a follow-up, coordinated separately.

---

## 8. Frontend — the logistics portal (new, separate app)

Emmanuel confirmed logistics POCs use a dedicated portal, separate from operations-app and web-app-ui —
its own frontend, its own login page hitting `POST /auth/logistics/login` (§2). Scaffold it as a new
Next.js 15 app (matching the stack of `operations-app`/`web-app-ui`) — suggested repo name
`logistics-portal`. Match the existing repos' tooling as closely as practical (TypeScript, Tailwind, the
same lint/format config) so it's not a foreign codebase to anyone who's worked in the other two.

Minimum screens — **note the identity/company backend behind these is already built (§2, §5b), and its real
behavior is simpler than earlier drafts of this spec assumed. Read the bullets below carefully, they're not
the same as a staff-invitation-style flow:**

- **Login** — email/phone + password or OTP (mirror whatever `web-app-ui`'s login already does, same
  credential flow, hits `POST /auth/logistics/login` instead). Show a clear, specific message for
  `403 NO_LOGISTICS_ACCESS` — "this account isn't attached to a logistics company" — distinct from a generic
  "invalid credentials" error, since the person's password may be entirely correct. **This screen doubles as
  the invitation-acceptance screen** — per §2, there is no separate accept step or token; a first successful
  login for an `INVITED` member is what activates them. Don't build a token-based accept page, there's no
  endpoint for it.
- **Invite a POC** (part of the Team screen below): per §2, inviting someone never dead-ends — build against
  the real, already-built response shape, `{ outcome: 'LINKED', member }` or
  `{ outcome: 'PENDING', invitation }`. Show two distinct success states, not one generic "invited":
  **"added — [name] can log in now"** for `LINKED` vs. **"pending — will get access once they sign up with
  this email/phone"** for `PENDING`. There is no `POC_ACCOUNT_NOT_FOUND` error to handle.
- **A visible "pending" state on the Team roster, and manual follow-up guidance either way**: whether a
  membership is pending because the person hasn't logged in yet (existing account) or because they haven't
  signed up yet at all (new account), the Team screen should surface both clearly and distinctly — the
  second case in particular is worth being honest about taking longer. Separately, since notification
  delivery isn't built (§2), nobody gets an email/SMS telling them they've been invited either way — the
  Team screen should make pending entries obvious so a company `ADMIN` knows who still needs to be told
  directly, out of band. This is a real UX gap worth designing around explicitly, not hiding, until M11
  notification wiring exists.
- **Package requests list** — filterable by status, with the accept/reject action prominent for
  `REQUESTED` items.
- **Package detail** — the full pipeline for one package, with the "advance to next stage" action
  (including the tracking-number field, required specifically at the `SHIPPED` transition) and the
  rejection-reason field when rejecting.
- **Team (POCs)** — Admin-only: invite a new POC (`POST /logistics/members`), see the roster with status
  (`GET /logistics/members`), change a POC's role or remove them (`PATCH /logistics/members/:id`). Handle
  `409 LAST_ADMIN` gracefully — surface it as "you can't remove/demote the only admin, promote someone else
  first," not a generic error.

---

## 9. Frontend — operations-app additions

A new **Logistics** tab, same directory pattern as the existing Customers/Staff tabs, with two subs:

- **Companies** — list/search against the already-built `GET /admin/logistics/companies`, an
  onboard-a-new-company form hitting `POST /admin/logistics/companies` (name + initial POC contact — this
  always succeeds now; show whether the POC was matched to an existing account (`LINKED`) or is pending
  their signup (`PENDING`), same two-state distinction as §8's invite form), enable/disable toggle via
  `PATCH .../:id`, drill into a company to see its POC roster via `GET .../:id/members` (read-only from the
  admin side — POC management itself happens in the logistics portal, per §8, not here).
- **Packages** — the cross-company package list from `GET /admin/logistics/packages` (§5a), for ops
  visibility into every in-flight shipment regardless of which company is handling it. Filter by status,
  company, date range. This is a read/support view, not where packages get accepted/rejected/advanced —
  that's the company's own job in the logistics portal.

---

## 10. Frontend — web-app-ui addition (ship step)

On the existing ship step, add a dropdown above (or replacing) the current manual courier/tracking form:

- Every `ENABLED` logistics company, from `GET /me/logistics/companies`.
- A permanent **"Arrange my own shipping"** option — confirmed by Emmanuel this never goes away, it's not a
  bootstrap-only fallback: "lets permanently keep the self arranged option." Selecting it shows the existing
  manual courier/tracking form exactly as it works today.
- Picking a company calls `POST /trades/:tradeCode/ship/company` (§5c) instead, and the seller should land on
  a state that reads as "pickup requested" rather than "shipped" — the trade isn't actually dispatched yet,
  it's `awaiting_shipment` (§7a) until the company gets to the `SHIPPED` stage.
- If the company later rejects the request, the seller needs to see that (their own package/trade detail
  view should surface the `REJECTED` status and the reason) and be routed back to this same dropdown to pick
  again.

---

## 11. Pricing — explicitly decided, read this before adding any price field anywhere

This was an open gap in earlier drafts of this spec — the module had no answer for how a logistics company's
delivery price ever reaches the seller. **Decided by Emmanuel, 2026-08-30: v1 carries no pricing mechanism at
all.**

Concretely:

- Sellers pick a company by name/reputation only — no rate card, no quote, no price shown anywhere in Kumtru
  for a company-handled delivery.
- The actual shipping fee is agreed and paid **directly between the seller and the logistics company,
  entirely outside the platform** — however they'd normally arrange it (a call, a message, cash, whatever).
  Kumtru is not a party to that payment and never sees the amount.
- **This means the shipping fee never touches escrow or the M8 ledger.** A logistics company is not a payee
  on a trade, gets no `payout_accounts` row, and needs no Transfer/Refund handling of its own. Don't add any
  pricing, quote, or company-payout concept to the schema in §3, and don't wire anything logistics-related
  into `src/modules/ledger/` — that module's payee model (buyer/seller only) stays exactly as M8 built it.
- Do **not** add a price/rate/quote field to `logistics_companies` or `logistics_packages` for this pass —
  if this decision changes later, that's a deliberate follow-up spec revision, not something to build ahead
  of.
- The considered alternatives (a published rate card by size/destination/speed, a live per-request quote
  negotiation, or a simple flat rate per company) were weighed and set aside for v1 specifically to avoid
  scope creep into a rate-modeling problem and a potential three-way payment split — revisit if and when
  real per-company rate data and a business reason to broker it in-platform both exist.

## 12. Explicit non-goals for this pass

- No pricing/rate negotiation, quoting, or company payouts of any kind — see §11, this is a firm decision,
  not an oversight.
- No SLA tracking or performance scoring of companies — out of scope for v1.
- No multi-company membership per POC (§3) — one active company per person, confirmed.
- No changes to `trade.service.ts`'s state machine without separate sign-off (§7b) — build up to the event
  publish, no further.
- No bespoke job scheduler for the auto-complete timeout — that's shared infrastructure work, not this
  module's job (§7b).
- No courier API integrations (no real-time carrier tracking pulled from a third party) — tracking numbers
  are just strings the company's own POC types in, not verified against a carrier's API.

---

## 13. Open questions — need Emmanuel's answer, don't guess

Pricing (previously open question #1 in earlier drafts) is now resolved — see §11. What's left:

1. Where does a package rejection get logged on the trade side — `tradeStateChanges`, `tradeTrustEvents`, or
   a new trade-activity-log concept? (§6)
2. The exact approach for splitting `confirmDelivery` into `markDelivered`/`confirmReceipt`, and whether
   that's a status-enum addition (`AWAITING_CONFIRMATION`) or something else Emmanuel prefers (§7b).
3. Whether `inspectionPeriod` gets converted to a structured duration now or left as-is with parsing done at
   deadline-computation time (§7a).
4. Notification channel/copy for "your package was delivered, confirm receipt or it auto-completes in X" —
   this module should publish the event; which notification system (M11, presumably) consumes it and what
   the actual message says is a separate piece of work.
5. **Same open question, more urgent, already live in the built code**: nothing currently notifies an invited
   POC that they've been invited (§2) — right now that has to happen by someone manually telling them.
   Whether this gets a quick interim fix (e.g. the inviting POC/admin is shown a message to copy and send
   themselves) or waits for real M11 wiring is worth a decision rather than leaving it implicit.

---

## 14. Suggested build order

1. Schema: `logistics_companies`, `logistics_company_members`, `logistics_packages`,
   `logistics_package_status_events`. Get the partial-unique-index constraints right first — everything else
   depends on them behaving correctly under concurrent requests.
2. Identity extension (§2): `SessionScope` enum + `LOGISTICS`, the `/auth/logistics/login` endpoint, the
   `principal.service.ts` branch, the logistics-scoped route middleware. Test this in isolation before
   building anything on top of it — auth bugs here are the kind that are easy to miss and bad to ship.
3. Admin-facing company onboarding (§5a) + the operations-app Companies view (§9) — this is the shortest
   path to something demoable end-to-end (onboard a company, see it in the list).
4. Company-member invite/accept flow (§3, §5b) + the logistics portal's login and invitation-acceptance
   screens (§8) — mirror the staff-invitation pattern closely, don't redesign it.
5. Package request lifecycle (§5b, §5c, §6) — backend first, then the logistics portal's package
   list/detail screens, then the web-app-ui ship-step dropdown (§10).
6. `logistics.package.delivered` event publishing — build the publish side, stop there per §7b.
7. Operations-app Packages admin view (§9) — this can happen in parallel with step 5 once the schema and
   basic list endpoint exist.

## 15. Definition of done / testing checklist

- Every state transition in §6 is rejected with a clear error if attempted out of order (test both the
  happy path and at least one invalid-jump attempt per stage).
- The one-active-company-per-POC constraint actually holds under a concurrent invite-accept race, not just
  in the happy path — write a test that tries to create two active memberships for the same user and
  confirms the second one fails.
- A `LOGISTICS`-scoped token cannot access any `STAFF`-scoped or `CONSUMER`-scoped route, and vice versa —
  mirror however the existing staff/consumer scope-isolation tests are written today (there should be
  existing coverage for control C1/C2 to model this on).
- A rejected package correctly bounces the seller back to a state where they can pick a different company or
  self-arrange, and the rejection is visible somewhere in the trade's own history (once §13.1 is answered).
- The RBAC catalog test (`tests/identity/rbac.test.ts`) still passes with its counts updated, if you added
  any staff-side permissions for the admin-facing endpoints.
- No price/rate/quote field or company-payout logic exists anywhere in the diff — per §11, this is v1's
  explicit boundary, not something to build ahead of a future decision.
