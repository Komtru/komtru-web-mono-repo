# Komtru Platform — Fresh Monorepo Design

**Status:** Draft for owner review · 2026-10-05
**Inputs:** `docs/MASTER_BUILD_PROMPT.md`, `docs/specs/*` (20 module specs, `m2-logistics-module-spec.md`, `m8-payment-provider-adapter-plan.md`, two socket setup guides), `docs/design-reference/Komtru — UI Screens Living Master File.html`, and the four old repos under `../kumtru/` (read-only).
**Companion:** `docs/TICKETS.md` (the numbered ticket list) and `docs/tickets/*.md` (ticket detail).

This document records what will be built, every place the inputs disagree and how that is resolved, and the decisions that still need the owner. Nothing here is implemented yet.

---

## 1. Understanding

### What the owner asked for (stated)

- A from-scratch Komtru monorepo: one backend API and five frontends (`web-app-ui`, `operations-app`, `logistics-ops`, `park-agent-app`) plus four shared packages, under one task runner.
- Old repos are mined, not imported. Anything lifted verbatim is named up front, re-tested, and re-reviewed.
- The HTML living master file is the near-literal source of truth for layout, flow, tokens and brand marks.
- Scale from day one: paginated lists, BullMQ for all external I/O, idempotency keys, Redis rate limits, connection pooling, structured logging plus error tracking, stateless API processes.
- Park is modelled as the default logistics company, built on the general courier primitives, with its own custody tables, PIN handover, TrustOps review and a mobile-web agent app.
- Ticket-by-ticket delivery with TDD, an AI review pass and local merges. Nothing is pushed until every ticket is done.
- First deliverable is the ticket list, then stop for review.

### Assumptions made here (owner can correct)

- The old backend's live credentials are reused, except the database name (§3.4).
- Komtru is pre-launch. No production data migrates from the old system.
- "Every screen in the HTML" means the 210 numbered screens in the reference, mapped to apps in §8.3.
- Where the HTML and a module spec disagree on _behaviour_, the HTML wins for user-facing flow and the spec wins for data integrity and money rules (§2).

### Success criteria

The master prompt's Definition of Done, unchanged, plus: every resolved conflict in §5 has a ticket that implements the stated resolution, and every open decision in §12 is either answered or shipped behind its stated default.

---

## 2. How conflicts between inputs are resolved

The inputs were written at different times and disagree in places. One precedence order is applied everywhere:

1. **The master build prompt** (newest, explicit owner intent).
2. **Decision-bearing build specs** — `m2-logistics-module-spec.md` and `m8-payment-provider-adapter-plan.md`. Settled decisions there (pricing non-goals, state-machine shapes, RBAC model) are not re-litigated.
3. **The HTML reference** for anything a user sees or does: screens, flows, copy, tokens.
4. **The 20 conceptual module specs** for scope, data integrity, money and security rules.
5. **The old code** only as evidence of what worked.

When a lower source conflicts with a higher one, the higher wins and the ticket that touches it says so. §5 lists every conflict found.

---

## 3. Stack and tooling

### 3.1 Monorepo

| Concern         | Choice                                                      | Note                                                                                     |
| --------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Package manager | **pnpm 10** for everything                                  | The backend moves off Yarn so one lockfile covers all apps.                              |
| Task runner     | **Turborepo**                                               | Remote cache optional; local plus CI cache from day one.                                 |
| Runtime         | **Node 22 LTS**                                             | Matches the old `.nvmrc` and the local machine.                                          |
| Language        | TypeScript 5, `strict`                                      | Shared base `tsconfig` in `packages/config`.                                             |
| Lint/format     | ESLint 9 flat config plus Prettier 3, one shared config     | Includes a module-boundary rule for the backend (§4.2).                                  |
| Commits         | Husky, lint-staged, commitlint (conventional)               | Kept from the old backend.                                                               |
| Tests           | **Vitest** everywhere, Playwright for e2e and visual checks | Replaces Jest. Vitest runs TS and ESM natively, one runner across backend and frontends. |

### 3.2 Backend (`apps/backend-api`)

| Concern        | Choice                                                 | Change from old build?                                                                                                                                         |
| -------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP           | Express 5                                              | Same.                                                                                                                                                          |
| ORM/migrations | **Drizzle ORM plus drizzle-kit**                       | Kept. Schema-per-module convention kept.                                                                                                                       |
| Validation     | **zod**, schemas shared via `packages/shared-types`    | Changed from Joi so frontend and backend share one schema per DTO.                                                                                             |
| Database       | PostgreSQL 15+ (16 locally)                            | Same.                                                                                                                                                          |
| Pooling        | **PgBouncer, transaction mode**, from the first commit | New. Migrations use a direct URL. App code avoids session state (no session-level prepared statements, no advisory locks across statements, no LISTEN/NOTIFY). |
| Queue/jobs     | BullMQ on Redis, job scheduler for crons               | Same.                                                                                                                                                          |
| Realtime       | Socket.IO with the Redis adapter                       | Same, per the socket setup guide.                                                                                                                              |
| Logging        | pino, JSON in production, request-id correlation       | Same.                                                                                                                                                          |
| Error tracking | **Sentry** (`@sentry/node`) in API and worker          | New. Needs a DSN (§12).                                                                                                                                        |
| Rate limiting  | `rate-limiter-flexible` on Redis                       | Changed from in-memory `express-rate-limit` so limits hold across instances.                                                                                   |
| Process model  | Separate API and worker processes from one build       | Same. Deploy runtime pending §12 Q1.                                                                                                                           |

### 3.3 Frontends

Next.js 15 (App Router), React 19, Tailwind CSS 4 (CSS-first `@theme`, tokens from `packages/ui-kit`), TanStack Query 5, Zustand 5 for session state only, react-hook-form with zod resolvers (replacing Formik plus Yup so forms reuse the shared schemas), Radix primitives wrapped by `ui-kit`, Socket.IO client per the frontend socket guide, Storybook 8 for `ui-kit`.

Auth in browsers: the access token lives in memory; the refresh token sits in an `httpOnly`, `Secure`, `SameSite=Lax` cookie set by a thin Next.js route handler per app that proxies `/auth/*`. Each app's cookie is scoped to its own subdomain, so a consumer session can never be replayed against the ops or logistics origins.

### 3.4 Environment and secrets

- `docs/specs/backend-apis.env` is the old backend's live `.env`. It is git-ignored (verified with `git check-ignore`) and its contents never appear in logs, PRs or docs.
- `apps/backend-api/.env` is populated from it. The new config keeps the old variable names wherever the meaning is unchanged (`POSTGRES_URL`, `REDIS_URL`, `ENCRYPTION_KEY`, `IDENTITY_*`, `CLOUDINARY_*`, `PAYSTACK_*`, `MAILJET_*`, `TERMII_*`, `FCM_*`, OAuth keys), so the old file drops in without renaming.
- **One deliberate deviation:** `POSTGRES_URL` points at the shared RDS dev database `komtru_dev`, which the old backend has already migrated. Running a fresh schema there would collide with the old `identity`, `trades` and `ledger` schemas. The new build keeps the same host and credentials but uses a new database name, `komtru_v2_dev`, and local development uses Docker Postgres. This is the "specific reason to rotate" the prompt allows.
- `REDIS_URL` is `localhost`, so local Docker Redis satisfies it. All new BullMQ queues and socket channels use the key prefix `komtru:` to avoid colliding with any old worker that shares an instance.
- New variables the old file does not have: `POSTGRES_DIRECT_URL`, `SENTRY_DSN`, and the frontends' `NEXT_PUBLIC_KOMTRU_*` variables. Fees and cuts live in the fee file (§6.5); other tunables are M17 config rows. Neither is an env var.
- Paystack keys are test-mode. The Paystack dashboard's webhook URL still points at the old backend and must be repointed at cutover.

---

## 4. Architecture

### 4.1 Repository layout

```
komtru/
  apps/
    backend-api/          api.komtru.com        Express API + BullMQ worker (two processes, one build)
    web-app-ui/           app.komtru.com        one consumer app, no role views; Park hub *application* flow;
                          passport.komtru.com   public Trust Passport / seller profile pages (host rewrite)
    operations-app/       ops.komtru.com        TrustOps console
    logistics-ops/        logistics.komtru.com  courier-company POC portal
    park-agent-app/       park.komtru.com       mobile-web custody app for activated Park Agents
  packages/
    config/               tsconfig, eslint, prettier, tailwind preset, vitest preset
    shared-types/         zod schemas, DTOs, enums, money + pagination + error contracts
    ui-kit/               tokens (verbatim from the HTML), brand mark, primitives, TrustOps patterns
    api-client/           typed client, auth refresh, idempotency, retry queue, query hooks
  docs/
    specs/                reference specs, verbatim (backend-apis.env here, git-ignored)
    design-reference/     the HTML master file, verbatim, never edited
    tickets/              ticket detail per epic
    superpowers/specs/    this design
    TICKETS.md            ticket index + live status
  .github/workflows/      one workflow per app + shared composite actions
  docker-compose.yml      postgres, pgbouncer, redis, mailpit for local dev
  turbo.json  pnpm-workspace.yaml
```

### 4.2 Backend module shape

Each module lives in `apps/backend-api/src/modules/<name>/` with `domain/`, `services/`, `http/{controllers,routes,validations}.ts`, `infrastructure/`, `jobs/`, `bootstrap.ts` and an `index.ts` barrel. Modules are plain exported functions, no class hierarchies. An ESLint `no-restricted-imports` rule fails CI if one module imports another module's internals instead of its barrel.

Modules and Postgres schemas:

| Module                                             | Schema       | Spec                         |
| -------------------------------------------------- | ------------ | ---------------------------- |
| `platform` (outbox, idempotency, processed events) | `platform`   | master prompt §2             |
| `identity`                                         | `identity`   | M1                           |
| `files`                                            | `files`      | M20                          |
| `notify`                                           | `notify`     | M11                          |
| `config`                                           | `config`     | M17                          |
| `geo` (states, cities, city requests)              | `geo`        | owner ruling, §7.8           |
| `trust`                                            | `trust`      | M6                           |
| `merchant`                                         | `merchant`   | M5                           |
| `search`                                           | `search`     | M19                          |
| `trades`                                           | `trade`      | M7 (reconciled, §6)          |
| `orders`                                           | `orders`     | M9                           |
| `ledger`                                           | `ledger`     | M8 + m8 plan                 |
| `disputes`                                         | `disputes`   | M3                           |
| `logistics`                                        | `logistics`  | m2 build spec                |
| `park`                                             | `park`       | master prompt §3             |
| `support`                                          | `support`    | M10                          |
| `risk`                                             | `risk`       | M13                          |
| `reputation`                                       | `reputation` | M12                          |
| `admin`                                            | `admin`      | M14 (adapted, §5 C2)         |
| `compliance`                                       | `compliance` | M15                          |
| `analytics`                                        | `analytics`  | M16                          |
| `growth`                                           | `growth`     | M18                          |
| `cases`                                            | `cases`      | HTML P0-01/P0-02             |
| `messaging`                                        | `messaging`  | HTML C9/S9/AC7, socket guide |
| `devices` (IMEI lookup)                            | `devices`    | HTML AC4/IF1                 |

Nothing lives in `public`. Same-schema foreign keys are real with explicit `onDelete`. Cross-schema references are plain `uuid` columns.

### 4.3 Events: in-process bus plus a transactional outbox

The master prompt prescribes an in-process emitter for in-process effects and BullMQ for external I/O. That leaves a gap the old code also had: a cross-module effect such as `trade.completed` triggering the ledger release is lost if the process dies between the database commit and the handler. On a money platform that is not acceptable.

**Decision (a better approach, noted per Step 0):** every domain event is written to `platform.outbox` in the same transaction as the state change. A relay job in the worker publishes outbox rows to subscribers through BullMQ, at least once. Each subscriber records `eventId` in `platform.processed_events` and skips duplicates. The in-process typed emitter remains for effects that are safe to lose and recompute, such as cache invalidation and socket fan-out.

Envelope (M1 §11): `{ eventId, eventType, version, occurredAt, correlationId, causationId, actor, payload }`.

### 4.4 Scale-from-day-one mechanisms

| Requirement                  | Mechanism                                                                                                                                                                            | Enforced by                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Every list paginated         | `paginate()` helper (cursor by default, page/limit allowed for admin tables), shared `Paginated<T>` contract                                                                         | A route-registry test fails if a `GET` collection route lacks pagination params                                                              |
| External I/O only via BullMQ | Provider adapters live in `infrastructure/providers`, callable only from `jobs/`                                                                                                     | Lint rule plus a test that request handlers never import adapters                                                                            |
| Idempotency keys             | `Idempotency-Key` middleware backed by `platform.idempotency_keys`: unique on scope, key and actor; stores request hash and response; a short Redis lock covers in-flight duplicates | Required on every mutating route that declares `retryable: true`; all Park custody routes, funding, payouts and trade transitions declare it |
| Redis rate limits            | Per-IP, per-identifier and per-user limiters; PIN limiter per parcel, agent and hub                                                                                                  | Auth and PIN route tests                                                                                                                     |
| Pooling                      | PgBouncer in Docker Compose, CI and deployed environments                                                                                                                            | Integration tests run through PgBouncer                                                                                                      |
| Logging plus Sentry          | pino with request id and principal id; Sentry in API, worker and all Next apps                                                                                                       | Bootstrapped in the skeleton ticket before any module exists                                                                                 |
| Stateless processes          | No in-memory sessions, queues or rate limits; socket fan-out via the Redis adapter                                                                                                   | Integration test runs two API instances against one Redis                                                                                    |

Flows that look synchronous are made asynchronous rather than breaking the BullMQ rule. Paystack charges start client-side through Paystack Inline using a server-issued reference, and the webhook plus a verify job confirm them. Bank-name resolution, KYC checks and IMEI lookups create a pending record, run in a job, and push the result over the socket.

**One exception needs the owner's acknowledgement:** the OAuth authorization-code exchange during social login is a synchronous call in the callback handler, because the user is mid-redirect and a queued retry cannot finish the handshake. It runs with a strict timeout and a circuit breaker, and provider signing keys (JWKS) are refreshed by a scheduled job rather than fetched inline.

**Owner acknowledgement: pending** (raised with T-028, 2026-10-05).

#### How the rule is made structural (T-028)

- **One helper.** `src/platform/providers/http.ts` is the only place the backend calls `fetch`. Its deadline covers reading the response body, not just the headers, so a provider that sends headers and then stalls surfaces as a timeout. It retries only a call the caller declares idempotent (`GET`/`HEAD` by method; anything else must opt in because it carries a provider idempotency key), retries only failures a repeat can fix (network, timeout, `429`, `5xx`), and logs one line per attempt with every query value and any URL credentials redacted and no request or response body. `src/platform/providers/circuit-breaker.ts` serves the exception above, admitting one trial call when its reset window elapses.
- **Where provider code lives.** A provider adapter sits in `src/modules/<module>/infrastructure/providers/`. Its network-calling functions are exported from `<provider>.client.ts` and may be imported only from that module's `jobs/`. Everything pure — webhook signature verification, payload parsing, Cloudinary upload signing — lives in sibling files with no I/O, which request handlers may use freely.
- **Enforcement.** The ESLint rule `komtru/provider-clients` reports a `*.client.ts` imported from anywhere but `jobs/`, the provider HTTP helper imported from anywhere but a client, and a module file reaching the network directly (`fetch()`, `node:http`, `node:https`, `undici`). `apps/backend-api/test/platform/provider-boundaries.test.ts` scans `src/modules` for the same violations independently of ESLint, so the boundary survives the rule being disabled.
- **The flows this shapes** (implemented by their own tickets): Paystack charges start client-side through Paystack Inline against a server-issued reference, confirmed by the webhook and a verify job (T-071); KYC checks (T-050), bank-name resolution (T-051) and IMEI lookups (T-067) write a pending record, run in a job, and push the result to the client over the socket; Cloudinary uploads go straight from the browser to Cloudinary with a signature the API computes locally, so the backend never proxies the bytes (T-040).

---

## 5. Conflicts found and how they are resolved

| #   | Conflict                                                                                                                                                                                           | Resolution                                                                                                                                                                                                  | Source of truth                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| C1  | M7 spec state machine vs. old code's simplified `OPEN/AGREED/PROTECTED` vs. HTML flows (acceptance before funding, counter-proposals, post-funding cancellation, delivery deadlines, auto-release) | One reconciled machine, §6                                                                                                                                                                                  | HTML for flow, M7 for gates and audit |
| C2  | M14 D1 wants a separate `admin_users` table; M1 D2, m2 §2 and the master prompt want one `users` table with scoped sessions                                                                        | Same `users` row; staff via `STAFF` scope and role assignments in `identity`. M14 keeps impersonation and the admin action log only                                                                         | Master prompt                         |
| C3  | M2 conceptual spec (`logistics_partners`, `pickup_requests`, `shipments`) vs. m2 build spec (`logistics_companies`, members, packages)                                                             | m2 build spec. M2's provenance vocabulary survives as the delivery-signal source enum, extended with `PARK_CUSTODY`                                                                                         | m2 build spec                         |
| C4  | M8 spec: Flutterwave secondary adapter, batched payouts. m8 plan: Paystack only, Refund API for buyers, payout preference modes                                                                    | m8 plan. Every money row is provider-tagged so a second provider is additive                                                                                                                                | m8 plan                               |
| C5  | Old ledger used single-sided balance entries; M8 requires double-entry                                                                                                                             | Double-entry per M8 §4–5, with the m8 plan's tables layered on                                                                                                                                              | M8                                    |
| C6  | m2 open questions §13.1–3 (where rejections are logged, the confirmDelivery split, the inspection-period format)                                                                                   | Rejections go to a new append-only `trade.trade_activity` log. Delivery and receipt are separate states (§6). Inspection window is an integer `inspection_window_hours` sourced from Trade Standards        | M7 spec plus HTML CTS1                |
| C7  | HTML V1 shows a "Logistics fee ₦3,500" line in the buyer's total; m2 §11 says no shipping price ever touches the platform                                                                          | Line omitted; deviation noted on the funding UI ticket. Open decision Q5                                                                                                                                    | m2 §11                                |
| C8  | HTML V2 shows a per-trade virtual bank account; m8 §9 forbids Dedicated Virtual Accounts                                                                                                           | Use Paystack checkout's pay-with-transfer channel, which issues a temporary per-transaction account. The screen's promise still holds. Q6                                                                   | m8 plan                               |
| C9  | HTML AB7 "Komtru Wallet" top-up; no spec has stored value, and it raises licensing questions                                                                                                       | Blocked on Q3; default is the screen behind a disabled flag with no money movement                                                                                                                          | Owner decision                        |
| C10 | HTML V1 Buyer Protection Fee 1.5% paid by the buyer; M8's worked example deducts 5% from the seller                                                                                                | Buyer-side fee from the HTML, set in the fee file (§6.5) as `buyer_protection_fee.rate_bps: 150`. Q4 covers refund treatment                                                                                | HTML                                  |
| C11 | Master prompt models a fixed ₦300 platform rate, and HTML PE1/PH4 show hubs earning and withdrawing it through Komtru                                                                              | Superseded by C23: the handling fee never enters Komtru's books. Neither Park hubs nor courier companies are payees                                                                                         | Owner                                 |
| C12 | HTML puts Park Agent screens at `app.komtru.com/hub/*` inside the consumer app; master prompt requires a separate `park-agent-app`                                                                 | Split by auth state (§7.6): application and status screens stay in `web-app-ui` under consumer scope; operating screens move to `park-agent-app`. Old `/hub/*` operating URLs redirect to `park.komtru.com` | Master prompt                         |
| C13 | HTML Y1 adds a 48-hour auto-mediation window and "replacement" or "refund with return" outcomes; M3 has only an evidence window and four money outcomes                                            | New first dispute state `MEDIATION` (48h, config). Parties can agree one of M3's four money outcomes; return and replacement are recorded as agreed notes with self-arranged return shipping. Q10           | HTML plus M3                          |
| C14 | HTML "AI-suggested — not a decision" advisory boxes; no spec defines the AI                                                                                                                        | `cases.advisory` interface with a deterministic rule-based v1. An LLM-backed provider can plug in later. Q9                                                                                                 | HTML                                  |
| C15 | No spec covers trade messaging, Trade Standards, IMEI lookup, trade proposal review, or the universal case model, but the HTML does                                                                | Each gets its own module and ticket, scoped to what the screens need                                                                                                                                        | HTML                                  |
| C16 | M6 recommends Dojah plus Smile ID; no KYC or IMEI credentials exist in the `.env`                                                                                                                  | Adapter interface plus a deterministic fake adapter for dev and test; real adapters are wired but disabled until credentials arrive. Q7                                                                     | M6                                    |
| C17 | M1 recommends Google plus Apple only; the old build and the `.env` include Facebook                                                                                                                | All three. The M1 enum already includes `FACEBOOK` and credentials exist                                                                                                                                    | Old build, M1 enum                    |
| C18 | M5 leaves stock timing open (reserve at order vs. decrement at delivery)                                                                                                                           | Reserve at funding, release on cancellation or refund, never below zero (DB check)                                                                                                                          | Engineering default                   |
| C19 | M1/M7 gate selling behind an opt-in `SELLER` capability, and the HTML's role switcher gives every account a Buyer lens next to Merchant                                                            | Owner ruling 2026-10-05: every account can buy or sell, and the initiator picks the side per trade. Certified merchants can only sell. The `SELLER` capability gate is removed. See §6.3                    | Owner                                 |
| C20 | The HTML makes business verification optional at SO3 and shows only automated KYB review (AC10)                                                                                                    | Owner ruling 2026-10-05: merchant certification is an application with mandatory CAC documents, approved by a human in operations-app. Automated CAC checks are evidence for the reviewer, not the decision | Owner                                 |
| C22 | HTML Y2 role switcher and separate seller tab bar vs. owner's "no switch"                                                                                                                          | Owner ruling 2026-10-05: one trades list across both sides, no role views (§6.3)                                                                                                                            | Owner                                 |
| C23 | Master prompt's ₦300 platform rate and HTML PE1/PH4 hub earnings and withdrawals                                                                                                                   | Owner ruling 2026-10-05: agents collect ₦300–₦500 in cash directly from the buyer. Komtru only tells the buyer to expect it. No ledger entries, hub payout accounts, earnings or withdrawals                | Owner                                 |
| C24 | No spec ties Park availability to location; the HTML ship step offers Park Hub Transit unconditionally                                                                                             | Owner ruling 2026-10-05: Park can be chosen only for cities where an onboarded, operating hub exists (§7.8)                                                                                                 | Owner                                 |
| C21 | M17 D1 puts tunable defaults in a database settings table editable at runtime; the owner wants every fee and cut in an easily configurable file                                                    | Owner ruling 2026-10-05: one version-controlled fee file is the only source of fee and cut values (§6.5). M17's table keeps non-money tunables such as windows and retry caps                               | Owner                                 |

---

## 6. Trade lifecycle (reconciled, C1)

### 6.1 States

`DRAFT`, `PENDING_COUNTERPARTY`, `UNDER_PROPOSAL_REVIEW`, `AWAITING_ACCEPTANCE`, `PENDING_PAYMENT`, `FUNDED`, `SHIPPED`, `UNCONFIRMED_DELIVERY`, `INSPECTION`, `COMPLETED`, `SETTLED`, `DISPUTED`, `RESOLVED_REFUNDED`, `RESOLVED_RELEASED`, `CANCELLED_REFUNDED`, and the pre-funding terminals `DECLINED`, `REJECTED`, `CANCELLED`, `EXPIRED`.

### 6.2 Transitions

```
DRAFT ──send──▶ PENDING_COUNTERPARTY      counterparty invited, not yet a user (M1 party invitation)
      ──send──▶ UNDER_PROPOSAL_REVIEW     risk rule holds a stranger's proposal (HTML N1/N2, G3)
      ──send──▶ AWAITING_ACCEPTANCE
PENDING_COUNTERPARTY ──invitation claimed──▶ UNDER_PROPOSAL_REVIEW | AWAITING_ACCEPTANCE
                     ──14 days──▶ EXPIRED
UNDER_PROPOSAL_REVIEW ──ops clears──▶ AWAITING_ACCEPTANCE      ──ops rejects──▶ REJECTED
AWAITING_ACCEPTANCE ──counter-propose──▶ AWAITING_ACCEPTANCE  (new terms version, turn flips; W2/BR1)
                    ──accept (seller proof attached, W1)──▶ PENDING_PAYMENT
                    ──decline (SD1)──▶ DECLINED            ──cancel──▶ CANCELLED
PENDING_PAYMENT ──ledger: escrow funded──▶ FUNDED          ──cancel──▶ CANCELLED   ──deadline──▶ EXPIRED
FUNDED ──custody begins──▶ SHIPPED
       ──approved cancellation (CR1/CR2) | seller can't fulfil (SC1) | delivery overdue (DE3)──▶ CANCELLED_REFUNDED
SHIPPED ──trusted delivery signal──▶ INSPECTION            ──seller self-report──▶ UNCONFIRMED_DELIVERY
UNCONFIRMED_DELIVERY ──buyer confirms | grace elapses──▶ INSPECTION
INSPECTION ──buyer confirms & releases (Z5) | window elapses (AR1)──▶ COMPLETED
COMPLETED ──ledger: escrow released──▶ SETTLED
{SHIPPED, UNCONFIRMED_DELIVERY, INSPECTION} ──dispute──▶ DISPUTED
DISPUTED ──M3 resolved──▶ RESOLVED_REFUNDED | RESOLVED_RELEASED   (amounts recorded; partial splits allowed)
```

- "Custody begins" means a self-arranged shipment with waybill evidence (X2), a courier package reaching `SHIPPED`, or a Park parcel reaching `AT_SOURCE_HUB`. A courier package at `REQUESTED` to `PACKAGED` keeps the trade `FUNDED` with fulfilment substate `AWAITING_SHIPMENT`, which is m2 §7a's dormant value.
- Trusted delivery signals are buyer confirmation, a courier package `DELIVERED` (`PARTNER_PORTAL`), and a Park release (`PARK_CUSTODY`). A self-report becomes trusted if the trade already has a partner or custody signal (M7 §6 exception).
- M7's `DELIVERED` becomes an event and a timestamp, not a resting state, because inspection starts the moment delivery is trusted.
- M7's post-funding `SELLER_ACCEPTED` and `READY_TO_SHIP` are dropped. In the HTML the seller accepts before funding, and dispatch is locked until funding (X1).
- **Holds are not states.** `trade.trade_holds` rows (sources `PARK_EXCEPTION`, `RISK`, `ADMIN`) freeze auto-transitions and escrow release without hiding where the trade is. U6's "Trade Frozen" is a hold.
- Every transition is its own endpoint and goes through `canTransition(action, from)`. An invalid jump returns `409 INVALID_TRANSITION`. Every transition writes `trade_state_changes`, which is append-only and enforced by trigger.
- Deadlines are scheduled jobs: counterparty expiry, payment deadline, delivery deadline, unconfirmed-delivery grace, inspection window, mediation window. Each job is idempotent and re-checks state and holds before acting.

### 6.3 Trade roles and merchant certification (C19, C20)

**Owner ruling, 2026-10-05.** The person who starts a trade chooses whether they are the buyer or the seller on it. Every account has that choice by default. An account that applies for merchant certification and is approved becomes **sell-only**: it can never again take the buyer side of a trade while certification is active.

- **Role choice.** `POST /trades` takes `initiatorRole: 'BUYER' | 'SELLER'`. The counterparty takes the other side. For a certified merchant the field is forced to `SELLER`, and the API rejects `BUYER`.
- **Buy block.** One identity function, `canActAsBuyer(user)`, is false while the user holds an `ACTIVE` `MERCHANT` capability. It is checked server-side wherever someone would become a buyer: creating a trade as buyer, being named as the buyer on someone else's proposal, accepting as buyer, claiming a buyer invitation, cart checkout and buying from a listing. Failure returns `403 MERCHANT_CANNOT_BUY`. `PartyCard` carries `canBuy` so the proposer sees the problem before sending.
- **Trades already in flight** when certification is approved finish normally on both sides. The block applies only to new buyer roles.
- **Losing certification.** If certification is revoked or suspended, the account can buy again.
- **No `SELLER` capability gate.** M7 §5's "seller holds an `ACTIVE` `SELLER` capability" check is removed. The money-safety gates stay: the buyer must be contact-verified (level 1) to fund, and the seller must be identity-verified (level 2) before a trade can be funded, so payouts only go to verified people. Q12 asks whether that level-2 rule should be relaxed for casual sellers.
- **Merchant application.** Any account can apply. The form collects business name and type, registered address, categories sold, CAC registration number, CAC certificate, status report or memorandum, the proprietor or director's government ID, and a payout bank account. CAC documents are mandatory and the form cannot be submitted without them. The application is reviewed as a `MERCHANT_APPLICATION` case in operations-app. The reviewer sees the documents, the automated CAC lookup and the bank name-match as evidence, with an AI-suggested advisory, and decides one of approve, request changes or reject. A reason is always required.
- **On approval**, one transaction does all of the following. It grants the `MERCHANT` capability, sets `merchant_profiles.certified_at`, attaches the Verified Merchant badge, and publishes `merchant.certified`. Merchant-only features unlock: storefront, listings and insights (Q11). Business verification level 3 follows from M6 once the provider-attested CAC check and the business bank match pass.
- **No role views (C22).** There is no buyer view, seller view or role switcher. One Trades list shows every trade the person is party to, whether as buyer or seller, and each row and the trade detail state which side they are on. Seller-side steps such as accepting, shipping and submitting evidence appear inside that trade's detail, not in a separate area. Payouts and payout accounts are in Account for anyone who has sold. Certified merchants additionally get a Shop area for storefront, listings and insights, which takes the Explore tab's place because merchants cannot buy. The Park Agent entry point is an Account item that opens the hub application or, once active, `park.komtru.com`. HTML Y2 and the separate seller tab bar are not built.

### 6.4 Money flow

Trades never touch money. They write `escrow_action_requests` and publish events through the outbox. The ledger posts journal entries and answers with `payment.escrow_funded`, `payment.escrow_released` or `payment.escrow_refunded`. The funding total is the item price plus the buyer protection fee. On release the seller is credited the item price minus any seller or merchant commission, and the fee and commission are recognised as revenue. Every amount comes from the trade's fee snapshot (§6.5).

### 6.5 Fees and cuts: one config file (C21)

**Owner ruling, 2026-10-05.** Every fee and every platform cut lives in one file, `config/fees.yaml` at the repo root. No fee amount or rate appears anywhere else: not in code, not in database seeds, not in frontend bundles.

```yaml
# config/fees.yaml — the only place fees and cuts are set.
# Bump `version` whenever a value changes; CI fails otherwise.
version: 2026-10-05.1
currency: NGN

buyer_protection_fee: # paid by the buyer on top of the item price (HTML V1)
  rate_bps: 150 # 1.5%
  min_minor: 0
  max_minor: null # null = no cap
  refundable_on_full_refund: true # Q4

seller_commission: # platform cut from a casual seller's proceeds at release
  rate_bps: 0 # Q14
  min_minor: 0
  max_minor: null

merchant_commission: # platform cut from a certified merchant's proceeds at release
  rate_bps: 0 # Q14
  min_minor: 0
  max_minor: null

park_cash_handling_fee: # INFORMATIONAL ONLY (C23): shown to buyers, never charged,
  min_minor: 30000 # collected, posted or paid out by Komtru. The buyer pays the
  max_minor: 50000 # park agent this amount in cash at pickup.

payout_fee: # charged on each seller withdrawal
  amount_minor: 0
```

- **Validation.** A zod schema in `packages/shared-types` checks the file at backend boot and in CI: rates are whole basis points from 0 to 10,000, amounts are whole kobo, and a minimum never exceeds its maximum. The backend refuses to start on an invalid file.
- **Changing a fee** means editing the file, bumping `version`, and deploying. Git history is the audit trail. A CI check compares against `main` and fails if any value changed without a version bump.
- **Snapshots protect past trades.** When a trade's terms are accepted, the fee schedule version and the computed amounts are stored on the trade, so the buyer sees the exact total before funding and later file changes never alter it. A Park parcel snapshots the handling fee when it is created. Every ledger posting uses the snapshot, never the live file.
- **One calculator.** `computeTradeFees(itemMinor, sellerKind, schedule)` in `packages/shared-types` is pure, integer-only, and rounds half up to the kobo. The backend uses it for postings, and frontends display results from the API rather than computing totals themselves.
- **Reading fees.** `GET /config/fees` serves the current schedule for display: V1's fee breakdown, the Park cash-fee notices, and the read-only fee panel in operations-app.
- **Enforcement.** A test fails if ledger, trades, park or merchant code contains a numeric literal equal to any value in the fee file, or imports fees from anywhere except the fee module.

---

## 7. Park design

### 7.1 Concepts

- **Logistics company** (general): a courier with POCs who accept, ship and deliver end to end (m2).
- **Park**: one `logistics_companies` row with `is_default = true`, pinned first in the ship-step list. A partial unique index allows at most one default.
- **Park Hub**: a physical motor-park terminal and the custody location. It exists independently of the people who run it.
- **Park Agent**: a person. Technically a `logistics_company_members` row on the Park company plus one or more `park_hub_agents` assignments carrying per-hub permission flags.
- **Parcel**: one custody record per trade routed through Park.

### 7.2 Data model (`park` schema, plus Park's rows in `logistics`)

| Table                                          | Purpose                                                                                                                                                                                                                                                                                                                                          | Key constraints                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `park_hubs`                                    | Terminal: code (`H-JIB-004`), name, operator business (`God is Good Motors`), branch, `city_id` (catalog city, §7.8), street address, landmark, optional GPS pin, `status` (`PENDING`, `ACTIVE`, `SUSPENDED`), `operating_state` (`OPEN`, `CLOSED`, `FULL`, `UNABLE_TO_RECEIVE`), operating hours, authorization `verified_at` / `review_due_at` | Unique code. Partial unique on normalised (operator, branch, address) for live hubs, which stops duplicate claims of one terminal (gap audit item 1)                       |
| `park_hub_applications`                        | Onboarding case: applicant user, origin (`SELF_SERVE` from PH1–PH5, `TRUSTOPS_REGISTERED` from TO-PA6/TO-PA10), step data, evidence file refs (identity, authorization, mandatory photo gate), payout account ref, `status` (`DRAFT`, `SUBMITTED`, `IN_REVIEW`, `CHANGES_REQUESTED`, `APPROVED`, `REJECTED`), assigned reviewer, SLA             | Submit blocked without authorization evidence                                                                                                                              |
| `park_hub_agents`                              | Hub ↔ member assignment: `can_receive`, `can_inspect`, `can_release`, `can_add_staff`, `role_label` (`PRIMARY_AGENT`, `STAFF`), `status` (`INVITED`, `ACTIVE`, `SUSPENDED`, `REMOVED`), granted/revoked by and at                                                                                                                                | Rows are never deleted. Partial unique: one live row per (hub, member); one live `PRIMARY_AGENT` per hub. `can_release` requires a TrustOps approver id (check constraint) |
| `park_parcels`                                 | One per trade: soft `trade_id` (unique), origin and destination hub FKs, waybill, transit carrier, driver phone, plate, `status` (`AWAITING_SOURCE_DROPOFF`, `AT_SOURCE_HUB`, `IN_TRANSIT`, `AT_DESTINATION_HUB`, `RELEASED`, `EXCEPTION`), `status_before_exception`                                                                            | Unique `trade_id`. `canTransition` plus 409. Origin may equal destination, which skips `IN_TRANSIT`                                                                        |
| `park_custody_events`                          | Append-only: parcel, hub, actor member, `kind` (`DROPOFF_RECEIVED`, `ARRIVAL_LOGGED`, `INSPECTED`, `PIN_ATTEMPT`, `RELEASED`, `EXCEPTION_RAISED`, `EXCEPTION_CLEARED`, `DISPATCHED`), seal state (`INTACT`, `DAMAGED`, `TAMPERED`), photo `file_id` (M20 `TRADE_ASSET` pool, `PRIVATE_CASE`), `occurred_at` from the server                      | Update and delete blocked by trigger                                                                                                                                       |
| `park_handover_pins`                           | One per parcel and leg (`DROPOFF`, `PICKUP`): `pin_hash` (domain-separated HMAC), `pin_enc` (AES-GCM, revealed only to the leg's rightful party), `attempts_count`, `max_attempts` (3), `locked_at`, `verified_at`                                                                                                                               | Never plaintext. Partial unique: one live PIN per (parcel, leg)                                                                                                            |
| Fee file entry `park_cash_handling_fee` (§6.5) | ₦300–₦500 range shown to buyers as a cash-at-pickup notice (C23)                                                                                                                                                                                                                                                                                 | Display only. No price, fee or payout column exists in the `park` schema                                                                                                   |

### 7.3 Auth and authorization

- Park Agents authenticate through the **existing `LOGISTICS` scope** and `POST /auth/logistics/login`, the same route courier POCs use. No fourth scope is added: one credential path is easier to audit, and Park differs only in what the member may do, which is authorization.
- Every request re-resolves the principal's membership. Park routes additionally require membership in the default Park company and an `ACTIVE` `park_hub_agents` row for the hub being acted on, with the specific permission flag. The hub is resolved server-side from the agent's assignments and is never trusted from the client.
- All Park Agents are `OPERATOR` members of the Park company. Company-level administration of the Park network belongs to TrustOps staff (`STAFF` scope, `park.manage` permission), not to agents. `can_add_staff` lets an agent invite hub staff; release rights for staff still need TrustOps approval (TO-PA3 "Restricted").
- The self-serve applicant (PH1–PH6, PA7, PA8) is not yet a Park member, so those screens run under `CONSUMER` scope in `web-app-ui`.

### 7.4 Flows

1. **Onboarding.** An application is created either by a consumer (PH1–PH5) or by TrustOps (TO-PA6, TO-PA6B, TO-PA10). It registers as a case (`PARK_HUB_APPLICATION`) and moves through review (TO-PA1, TO-PA2) with an AI-suggested advisory, then approve, request changes (PA8 loop) or reject. **Activation (TO-PA3) is one transaction:** hub `ACTIVE`, Park company membership created (`INVITED` until first logistics login, then `ACTIVE`), `park_hub_agents` rows with the exact flags, events `park.hub.created` and `park.hub.activated`. Activation is refused while identity or authority checks are unresolved. No bank or payout details are collected, because hubs are never paid through Komtru (C23).
2. **Ship step.** The seller picks Park (pinned first), a destination hub, and optionally an origin hub. That creates `park_parcels` in `AWAITING_SOURCE_DROPOFF` and issues the `DROPOFF` PIN to the seller and the `PICKUP` PIN to the buyer (AB2).
3. **Drop-off.** The source hub agent with `can_receive` logs the parcel by trade code or waybill scan, validates the seller's drop-off PIN, and records seal state and photo. Parcel moves to `AT_SOURCE_HUB`; trade moves to `SHIPPED`; `park.parcel.received` fires with `leg: SOURCE`.
4. **Transit.** Dispatch details (carrier, driver, plate, waybill) are recorded, then `IN_TRANSIT`.
5. **Arrival.** The destination agent logs arrival (U2) and inspects (U3). `park.parcel.received` fires with `leg: DESTINATION`, then `park.parcel.inspected`.
6. **Release.** The agent with `can_release` validates the buyer's pickup PIN (U4). On match: `RELEASED` and `park.parcel.released`. The agent collects the handling fee from the buyer in cash, and Komtru records nothing about it. On mismatch: attempt counted (U5); at three attempts the PIN locks, release freezes, and a custody case opens (TO-PA5).
7. **Exceptions.** A `DAMAGED` or `TAMPERED` seal, or an incident report (PA10), moves the parcel to `EXCEPTION`, places a `PARK_EXCEPTION` hold on the trade (U6), and opens a custody case. TrustOps can clear (parcel returns to its prior state, hold lifted), keep held, or escalate to a dispute.
8. **Ageing.** A scheduled rule opens a custody case when a parcel is held past the configured threshold (P0-04, default 48h; buckets <6h, 6–24h, 24–48h, >48h).

### 7.5 Events

`park.hub.created`, `park.hub.activated`, `park.hub.suspended`, `park.parcel.received`, `park.parcel.inspected`, `park.parcel.exception`, `park.parcel.released`.

`park.parcel.released` is Park's equivalent of a courier's `logistics.package.delivered`. Both use one delivery-signal payload, consumed by the same trades handler:

```ts
type DeliverySignalPayload = {
  tradeId: string;
  source: 'PARTNER_PORTAL' | 'PARK_CUSTODY' | 'SELLER_SELF_REPORT' | 'BUYER_CONFIRMATION';
  occurredAt: string; // ISO, server time
  actorUserId: string | null;
  reference: { kind: 'LOGISTICS_PACKAGE' | 'PARK_PARCEL'; id: string } | null;
  hubId?: string; // PARK_CUSTODY only
};
```

The trade-side consumer (delivery → inspection → buyer confirms or auto-completes) ships in its own ticket, after both publishers exist.

### 7.6 Which app owns which Park screen

| Screens                                                           | App                                                | Scope                          |
| ----------------------------------------------------------------- | -------------------------------------------------- | ------------------------------ |
| PH1–PH6, PA7, PA8, reached from an Account item                   | `web-app-ui` (`/hub/register`, `/hub/application`) | `CONSUMER`                     |
| U1–U6, PE1, PA9, PA10                                             | `park-agent-app`                                   | `LOGISTICS` + Park membership  |
| PH7, TO-PA1–TO-PA11, NAV, P0-04, P0-05, P0-07                     | `operations-app`                                   | `STAFF` + `park.*` permissions |
| AB1, AB2 (buyer pickup PIN), X2 (seller chooses Park Hub Transit) | `web-app-ui`                                       | `CONSUMER`                     |

### 7.7 Money (C23)

- Park never touches Komtru's money. The handling fee is paid in cash by the buyer to the agent at pickup. No journal entry, payable, payout account, earnings balance or withdrawal exists for hubs, and a test asserts that `park.parcel.released` produces no ledger postings.
- Komtru's only job is to make the buyer aware. The `park_cash_handling_fee` range from the fee file appears:
  - when the seller picks Park Hub Transit (X2), so the seller can tell the buyer;
  - on the buyer's trade detail and live logistics view once Park is chosen (AB1);
  - on the pickup PIN screen (AB2);
  - in the "parcel arrived at the hub" notification.
- The agent's handover screen (U4) reminds the agent to collect the fee in cash. It records nothing.
- PE1 becomes a handover log (counts and recent releases) with no money shown. PH4 becomes an acknowledgement of the cash-fee rule with no payout setup. TO-PA6B and TO-PA10 drop the bank fields, and TO-PA4 drops "available fees". Each is a listed deviation in its UI ticket.
- The master prompt's `canManagePayouts` permission flag is dropped, since there is nothing to manage.

### 7.8 Coverage: Park only where hubs exist (C24)

**Owner ruling, 2026-10-05.** Park Hub Transit can be chosen only when the trade's destination city has an onboarded hub. A product going to Jos cannot use Park until a hub in Jos is live.

- **Location catalog.** Two database tables in a `geo` schema: `states` (Nigeria's 36 states plus the FCT) and `cities` (each belonging to one state, with a display name and search aliases). The catalog grows as coverage grows. TrustOps adds cities from operations-app, and nothing needs a deploy. Cities are always picked from the catalog; free text is never matched.
- **Dropdown APIs.** `GET /geo/states` returns the states. `GET /geo/states/:stateId/cities` returns that state's active cities. `GET /geo/cities?q=` is a typeahead. All are cursor-paginated per the platform rule, with a page size large enough for a dropdown to load in one request, and are cached. Every address, hub and trade form uses these dropdowns.
- **Missing cities.** When a user's city isn't listed, the address form offers "My city isn't listed". That records a city request with the state and the typed name, which TrustOps reviews and either adds to the catalog or merges into an existing city. The user is notified either way.
- **Delivery addresses.** Every user keeps one or more saved addresses: label, recipient name and phone, street line, landmark, a state and a city from the catalog, and a default flag. A user must have an address before taking part in a trade.
- **Hubs carry structured locations.** Every hub records its city, street address, landmark, optional GPS pin and operating hours. Onboarding cannot be submitted without a catalog city, by either the self-serve applicant or TrustOps.
- **Trades carry addresses.** The buyer picks one of their saved addresses as the delivery address, and the seller picks one as the ships-from address. Both are snapshotted into the trade terms, including state and city, so later edits to the address book never change a trade. Changing either is a counter-proposal like any other term change.
- **Serviceable city.** A city is Park-serviceable when it has at least one hub that is `ACTIVE` and `OPEN`, with at least one `ACTIVE` agent holding both `can_receive` and `can_release`. The coverage service computes this from live data, caches it in Redis, and invalidates the cache on any hub or agent change.
- **Where it is enforced.** The ship step (X2) offers Park only when the delivery city is serviceable, and then lists that city's hubs to pick from. Otherwise the option is shown disabled with "Park isn't available in Jos yet". The backend re-checks when the parcel is created and returns `409 PARK_NOT_AVAILABLE_IN_CITY`. The ships-from city must also be serviceable, because the seller drops the parcel at a hub there (Q15).
- **Coverage changing mid-trade.** If a destination hub is suspended or closes while a parcel is on its way, a custody case opens so TrustOps can redirect the parcel to another hub in that city or agree another route with the parties.
- **Visibility.** `GET /park/coverage` lists serviceable cities, paginated, and `GET /park/coverage/cities/:cityId/hubs` lists a city's available hubs. operations-app shows coverage by state and city, including cities with hubs in onboarding.

---

## 8. Frontend architecture and UI fidelity

### 8.1 Tokens and brand

`packages/ui-kit/src/tokens.css` is generated once from the HTML's `:root` block. All five copies in the HTML are byte-identical (verified): 52 custom properties covering colour, semantic soft/on-soft pairs, the three font stacks, the `--sp-*` scale, `--r-*` radii, `--shadow-*`, and `--dur-*` / `--ease-standard`. A parity test parses the reference HTML and fails if `tokens.css` drifts. The brand mark is the literal three-node SVG (emerald stroke) plus the "Komtru" wordmark in Space Grotesk 600, exported as `<KomtruMark />` and `<KomtruLogo product="Ops" />`. The HTML defines no dark theme, so none is invented.

### 8.2 Responsive rules (from the HTML)

Mobile is the baseline. Only layouts the HTML shows changing shape get desktop treatments (D1–D9, P2-D*, P3-D*, AN2). Tablet inherits the desktop shell with sidebar becoming top nav or collapsed rail (T1–T5, P2-T*, P3-T*, TO-PA9). Breakpoints: base, `sm` 640, `md` 768, `lg` 1024. Consumer and Park screens are mobile _web_ (browser chrome), not native-feeling.

### 8.3 Screen-to-app map (210 reference screens)

- **web-app-ui:** E*, TOS*, OB*, AC1–AC8, OF1, Z1–Z5, SE*, F*, K*, I*, MI*, P2-_, G_, CTS1, BEI*, AC4, IF1, G3, Q1, R1, C1–C10, CT*, AR1, CR*, SC*, V*, AB1–AB7, DE*, H*, Y1, AC6, SO*, S1–S10, EL*, W*, BR1, BVR1, SD1, X*, AN*, M1–M3, WF1, PR1, J*, AS*, VF1, CA*, LS1, TF*, Y2, AC5, SR*, NP1, AC7, MC1, L1, D1–D9, T1–T5, PH1–PH6, PA7, PA8, P0-03, P3-*.
- **operations-app:** N1, N2, P1, Z6, TO1, AC9, AC9b, AC10, PH7, NAV, TO-PA1–TO-PA11, P0-01, P0-02, P0-04–P0-07, plus spec-only screens with no reference (tickets, directory, audit timeline, config, analytics, notification dead-letter, logistics companies and packages per m2 §9).
- **park-agent-app:** U1–U6, PE1, PA9, PA10.
- **logistics-ops:** no reference screens exist. Built from m2 §8 using `ui-kit` and the TrustOps desktop shell patterns; the visual check is "design-system conformance" instead of screenshot-vs-reference.

The full list with line numbers and owning ticket lives in `docs/design-reference/SCREEN_INDEX.md`, generated during planning: all 210 screens map to exactly one UI ticket (web-app-ui 172, operations-app 29, park-agent-app 9). T-006 re-verifies it.

### 8.4 Per-screen process

Each UI ticket invokes the `frontend-design` skill per screen (the plugin is not installed yet; installing it is a prerequisite in the tickets), builds against `ui-kit`, then runs the Playwright visual check: it renders the reference section and the built screen at the same viewport and writes a side-by-side image to `docs/ui-review/<ticket>/`. Deviations are listed in the ticket before it can be marked done.

---

## 9. CI/CD

- One workflow per app (`backend-api.yml`, `web-app-ui.yml`, `operations-app.yml`, `logistics-ops.yml`, `park-agent-app.yml`), each path-filtered to its app plus the `packages/**` it depends on, and each with `workflow_dispatch`.
- Jobs: install (pnpm store plus Turbo cache) → lint → typecheck → unit + integration (backend gets Postgres, PgBouncer and Redis service containers) → build → deploy. Deploy runs only `if: github.ref == 'refs/heads/main'`, needs the test job, and targets that app's own destination.
- `backend-api` has a required `migration-safety` job before deploy: drizzle-kit snapshot/journal consistency, a clean apply on an empty database, a forward apply from the previous `main` schema, a dangerous-operation lint (non-concurrent index on existing tables, `NOT NULL` without default, column drops without a two-step plan), and an introspection test asserting every documented partial unique index and append-only trigger exists.
- Deploy targets are unconfirmed (Q1). Deploy jobs are written against a pluggable step and validated by `workflow_dispatch` dry runs on a feature branch. Per the no-push rule, those dispatch runs need a remote branch; the CI ticket marks this explicitly as needing the owner's go-ahead.

---

## 10. Testing strategy

- **TDD per ticket.** Tests first, red, then green.
- **Backend unit tests** for every pure domain function: state machines (every valid and at least one invalid jump per state), skeleton folding, money arithmetic, fee splits, PIN attempt logic, ranking.
- **Backend integration tests** against real Postgres through PgBouncer plus real Redis: constraints and partial unique indexes under concurrent inserts, append-only triggers, RBAC exhaustive matrix (every permission × every role, counts updated whenever a permission is added), scope isolation across `CONSUMER`/`STAFF`/`LOGISTICS`, idempotent replays, rate limits, outbox at-least-once delivery with duplicate suppression.
- **Security suites** from M1 §17: enumeration timing, social-linking attacks, session reuse and kill switch.
- **Provider adapters** are tested against recorded fixture payloads with real signature construction, and say so honestly (no live accounts in CI).
- **Frontends:** Vitest plus Testing Library for components and hooks; Playwright e2e for the critical paths (sign-up → propose → accept → fund → ship via Park → PIN release → inspect → settle); Playwright visual checks for every UI ticket.

---

## 11. Cannibalization audit (ticket T-001, completed in this pass)

Skimmed all four old repos and their `.claude/` folders. The `.claude/` folders contain only local permission settings, so there are no codified conventions to inherit.

**Lift verbatim, then re-test and re-review:**

| Piece (old path under `backend-apis/src/modules/`)                                                 | Why it earns a lift                                                                                         | Target ticket |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------- |
| `identity/domain/username/skeleton.ts` (+ `reserved.ts`)                                           | Subtle, versioned confusable folding with a reasoned narrow-glyph variant; already debugged against M1 §6.3 | T-033         |
| `utils/encryption.ts`                                                                              | AES-256-GCM with a versioned wire format; matches the reused `ENCRYPTION_KEY`                               | T-026         |
| `identity/infrastructure/crypto.ts`                                                                | Domain-separated HMAC, length-safe constant-time compare, unbiased numeric codes                            | T-026         |
| `identity/domain/credential/hashing.ts`, `breach.ts`                                               | OWASP argon2id parameters with rehash; k-anonymity HIBP check                                               | T-032         |
| `identity/domain/identifiers.ts`                                                                   | Email normalisation (provider folding), E.164 phones, masking, public ids                                   | T-026         |
| `files/infrastructure/cloudinary.ts`, `files/domain/rotation.ts`, `files/domain/pools.ts`          | Hand-rolled multi-account signing without the global-singleton SDK; quota-aware rotation                    | T-040         |
| `ledger/domain/providerAdapter.ts`, `ledger/infrastructure/providers/paystack/{client,webhook}.ts` | The m8 interface verbatim; HMAC-SHA512 raw-body verification that fails closed                              | T-071         |
| `scheduler/domain/registry.ts`, `scheduler/infrastructure/queue.ts`                                | BullMQ job scheduler with stable ids and orphan pruning                                                     | T-023         |

**Use as reference, rewrite:** `identity/domain/session/tokens.ts`, `identity/domain/social/linking.ts` (sound logic, no tests), `socket/*` (rewrite per the socket guide with tests), `logistics/*` (small; the new schema adds Park and packages), `notify/*`.

**Not used:** the old trades module (its state machine is superseded, §6), the old ledger's balance entries (superseded by double-entry), the `operations` command-centre module, all migrations, and all frontend code (the design system changed; screens are rebuilt from the HTML).

---

## 12. Open decisions for the owner

Each has a default that tickets ship with if no answer arrives. Only Q1 blocks anything outright, and it blocks deploy jobs only.

| #   | Question                                                                                                                        | Default if unanswered                                                                                                                                    | Blocks                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Q1  | Where does each app deploy, and which GitHub remote is the new repo? Old apps run under PM2 with no deploy automation.          | Deploy jobs written against an SSH + PM2 target, plus a Dockerfile per app; dispatch runs as dry-runs                                                    | Deploy jobs, T-004 dispatch validation |
| Q2  | Who bears the ₦300 Park handling fee?                                                                                           | **Answered 2026-10-05:** the buyer pays the agent ₦300–₦500 in cash; Komtru only displays it (C23)                                                       | —                                      |
| Q3  | Ship the Komtru Wallet (AB7)? Stored value likely needs CBN licensing.                                                          | Screen built behind a disabled flag; no wallet ledger                                                                                                    | T-077                                  |
| Q4  | Is the 1.5% Buyer Protection Fee refunded on cancellation and full refund?                                                      | Refunded on every full refund; retained on partial dispute outcomes                                                                                      | Nothing                                |
| Q5  | Confirm dropping V1's "Logistics fee" line (m2 §11)                                                                             | Dropped                                                                                                                                                  | Nothing                                |
| Q6  | Confirm Paystack pay-with-transfer for V2 instead of a DVA                                                                      | Pay-with-transfer                                                                                                                                        | Nothing                                |
| Q7  | KYC (Dojah/Smile ID) and IMEI-lookup provider accounts                                                                          | Fake adapters in dev/test; real adapters disabled until credentials exist                                                                                | Real verification only                 |
| Q8  | Provision Sentry and PgBouncer (or RDS Proxy) for deployed environments; create `komtru_v2_dev`                                 | Local Docker equivalents; Sentry no-ops without a DSN                                                                                                    | Deployed observability                 |
| Q9  | AI advisory: rule-based v1, or an LLM provider now?                                                                             | Rule-based behind an interface                                                                                                                           | Nothing                                |
| Q10 | Dispute mediation: are "replacement" and "refund with return" real outcomes needing return logistics?                           | Recorded as agreed notes; return shipping self-arranged                                                                                                  | Nothing                                |
| Q11 | Are storefront, listings and the listing-based discovery screens merchant-only, with casual sellers using trade proposals only? | Yes, merchant-only                                                                                                                                       | Nothing                                |
| Q12 | Must a casual, non-merchant seller still pass NIN/BVN plus liveness (level 2) before their trade can be funded?                 | Yes, to protect payouts                                                                                                                                  | Nothing                                |
| Q13 | Confirm the merchant application form fields in §6.3                                                                            | As listed in §6.3                                                                                                                                        | Nothing                                |
| Q15 | Must the seller's ships-from city also have a hub, since the seller drops the parcel at one?                                    | Yes, both cities must be serviceable                                                                                                                     | Nothing                                |
| Q16 | Which cities seed the catalog?                                                                                                  | Every state capital plus major commercial cities, reviewed by the owner before T-046 merges; TrustOps adds more as hubs onboard                          | Nothing                                |
| Q17 | Should address dropdowns list every catalog city, or only cities with Park coverage?                                            | Every active catalog city. Park coverage only decides whether Park can be chosen, so trades with couriers or self-arranged shipping work anywhere listed | Nothing                                |
| Q14 | What platform cut, if any, comes out of seller and merchant proceeds? The HTML shows only the buyer fee                         | 0% for both, set in the fee file                                                                                                                         | Nothing                                |

---

## 13. Risks

- **Scope.** 210 screens, 24 backend modules, five apps. The ticket list is long by necessity; the dependency graph keeps the critical path (platform → identity → trades → ledger → logistics/Park → screens) visible.
- **No push until the end** means CI can only run via manual dispatch on a pushed branch, which the no-push rule forbids. The CI ticket uses `act` locally for workflow validation and asks before any remote dispatch.
- **Shared dev database.** Mitigated by the separate database name (§3.4). Anyone pointing the new build at `komtru_dev` would damage the old environment.
- **Provider payloads are untested live.** Paystack, Dojah and IMEI adapters are fixture-tested only until real accounts are exercised.
