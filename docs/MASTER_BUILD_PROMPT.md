# Komtru — Master Build Prompt for Claude Code

Paste everything below this line into a Claude Code session, started in a **brand-new, empty directory**. This is a from-scratch build — not a migration.

Give that Claude Code session read access to `/Users/emmanuelahman/Documents/projects/nykon-externals/kumtru/`, which contains the four old repos — `backend-apis`, `logistics-ops`, `operations-app`, `web-app-ui` — purely as **reference material for mining**: conventions worth repeating, and any specific piece of logic worth cannibalizing wholesale (a tricky algorithm, a well-tested state machine, an encryption helper). Each old repo also has its own `.claude/` folder — worth a quick look for conventions a prior Claude Code session already codified there. Default to rewriting everything, with real tests and an AI review pass on every piece, rather than importing files wholesale. Follow this in order — don't skip Step 0.

---

## STEP 0 — Ground yourself before writing a single line

**This is a clean build.** No existing repo gets imported, no git history gets carried over, no existing file gets copied in wholesale. If something in the old code is genuinely worth keeping as-is (e.g. a subtle, already-debugged crypto routine, a gnarly-but-correct migration), say explicitly in the relevant ticket that you're cannibalizing it and why, copy only that piece, and still cover it with fresh tests and a review pass — don't give previously-written code a free pass just because it already existed.

**Brand.** The product is **Komtru** — that is the correct, final spelling. Use "Komtru" everywhere: repo/package names (`@komtru/...`), domains (`app.komtru.com`, `ops.komtru.com`, `passport.komtru.com`, `park.komtru.com` as needed), env var prefixes, UI copy, and code identifiers. Pull the actual brand marks — wordmark treatment, logo, and the full color/type/spacing token set — directly out of the attached HTML reference file (its CSS custom properties: `--komtru-midnight`, `--trust-indigo`, `--trust-emerald`, `--cloud-gray`, `--stone-gray`, `--trust-gray`, `--slate`, `--midnight-text`, the semantic success/info/warning/risk/neutral `-soft`/`-on-soft` pairs, `--font-display: 'Space Grotesk'`, `--font-body: 'Inter'`, `--font-mono: 'IBM Plex Mono'`, the `--sp-*` spacing scale, `--r-*` radii, `--shadow-*`, `--dur-*` motion durations) and use them as the literal, authoritative design system — don't approximate or redraw them.

**What the old code and specs are actually for, now that we're not importing them:**
1. **The real repos** (`backend-apis`, `logistics-ops`, `operations-app`, `web-app-ui`, all under `/Users/emmanuelahman/Documents/projects/nykon-externals/kumtru/`) — read-only reference for conventions that worked and for the occasional piece worth cannibalizing per the rule above. `backend-apis` is Node/TypeScript on Drizzle ORM (see its `drizzle.config.ts`), Yarn, Jest, ESLint/Prettier/Husky, PM2 for process management (`ecosystem.config.js`) — confirm whether the fresh build keeps Drizzle/Yarn/PM2 or switches (e.g. to pnpm to match the frontends), and say which in the relevant ticket rather than drifting into a silent mix. The three frontends are pnpm + Next.js + Tailwind already.
2. **Module-specific build specs that reference real branches/files** (e.g. `m2-logistics-module-spec.md`, `m8-payment-provider-adapter-plan.md`) — same treatment: read for the behavioral decisions already made (pricing non-goals, state machine shapes, RBAC model) so you don't re-litigate settled questions, but implement them fresh.
3. **The 20 conceptual module specs** (`module-00-infrastructure...md` through `module-20-file-and-evidence-management.md`) — design-intent documents; still the right starting point for each module's scope, just implement from zero.
4. **The attached UI reference HTML** — the visual/flow/brand source of truth for every screen. This one you treat as close to literal as possible, not just a conceptual reference.

**Patterns worth re-adopting from the old build, because they were sound engineering, not because anything is being imported:**
- One schema-per-module in Postgres (`identity`, `trades`, `logistics`, `park`, …), never `public`.
- Cross-module references are **soft** (plain `uuid`, no `REFERENCES`) across a schema boundary; same-schema FKs are real, hard FKs with explicit `onDelete` behavior.
- Backend modules as **plain exported functions, no class hierarchies** — `domain/`, `services/`, `http/{controllers,routes,validations}`, `infrastructure/`, `bootstrap.ts`, `index.ts` barrel, per module.
- **Scope-based sessions**, not separate account tables: a `SessionScope` enum (`CONSUMER` | `STAFF` | `LOGISTICS`, plus whatever Park Agents need — see Step 3), each scope with its **own login route** rather than a flag on one endpoint. Re-resolve role/membership on every request; never cache it on the token.
- Background jobs: an **in-process typed event emitter** for pure in-process effects; **BullMQ on Redis** for anything touching external I/O (SMS, email, push, provider calls, webhooks) or anything that must survive a crash.
- State machines (trade status, package status, membership status) enforced with an explicit `canTransition`-style domain function and a `409` on an invalid jump.
- Concurrency-sensitive invariants ("one active company per POC," "last admin can't be removed") enforced with **partial unique indexes** at the DB layer, not check-then-insert in the service layer.
- RBAC permissions in one catalog with an exhaustive-matrix test that stays green and gets its counts updated whenever a permission is added.
- Frontends as **Next.js 15 + TypeScript + Tailwind**, one shared lint/format config across all of them.

Adopt these because they're good defaults for this domain, not as an obligation — if you find a clearly better approach while rebuilding, use it and note why in the relevant ticket.

**Reuse the existing backend's `.env` as-is.** A copy of the old `backend-apis` repo's `.env` has been placed alongside the specs at `backend-apis.env` (in the same folder as the module docs — pull it in as a reference file, e.g. under `docs/specs/`). When you scaffold `apps/backend-api`, populate its `.env` from these same values rather than generating fresh credentials — these are live accounts (AWS, Cloudinary, Redis, Mailjet, OAuth, etc.) that already exist and are already wired up; regenerating them would just orphan the old ones for no benefit. Rotate a value only if you have a specific reason to (e.g. standing up a genuinely new resource the old backend never had), and say so explicitly in that ticket. Treat this file as a secret: never commit it, never print its contents in a PR description or log, and add it to `.gitignore` the moment it lands in the new repo.

---

## STEP 1 — Monorepo structure (built fresh)

Start one new repository with this layout from day one — no separate repos to later merge, because there's nothing to merge; everything is created inside this structure directly:

```
komtru/
  apps/
    backend-api/
    web-app-ui/              # customer + merchant/seller (buyer/seller/park-agent "lenses" on one account)
    operations-app/          # TrustOps / internal admin
    logistics-ops/           # courier-company POC portal — named to match the old repo it's mined from
    park-agent-app/          # mobile-web app for Park Hub / Park Agent custody flows
  packages/
    shared-types/            # DTOs, enums, zod schemas shared frontend↔backend
    ui-kit/                  # design-token-driven component library (see Step 4)
    api-client/              # typed fetch/query-client wrapper per frontend
    config/                  # eslint/tsconfig/tailwind base configs
  docs/
    specs/                   # the 20 module docs + module-specific build specs, copied in verbatim, reference-only
    design-reference/        # the UI living master HTML, copied in verbatim, never edited
  .github/workflows/         # see Step 5
  turbo.json / pnpm-workspace.yaml
```

Pick one task runner (Turborepo is the reasonable default for 5 apps + 4 packages) and say which. Each app keeps its own `package.json`, build, and deploy target — this is an organizational choice, not a reason to merge the four (five, counting Park) frontends into one app or share a single deploy artifact.

---

## STEP 2 — Scale-from-day-one requirements (apply to every endpoint and job as you write it, not as a later pass)

- **Every list endpoint is paginated** (page/limit or cursor-based) from the first line of code — no unpaginated `SELECT *` anywhere, including "admin-only, low volume" endpoints.
- **Every external I/O call goes through BullMQ, never inline in a request handler.**
- **Idempotency keys** on every mutating endpoint that could plausibly be retried by a flaky connection — this matters especially for `park-agent-app`, used in the field over potentially bad motor-park connectivity (scan-arrival, PIN-validate-handover, mark-damage all need to be safely retryable).
- **Rate limiting**, Redis-backed, on every auth route and on PIN-attempt endpoints specifically — cap attempts, then flag-for-TrustOps-review, per the design reference.
- **Connection pooling** (PgBouncer or RDS Proxy) in front of Postgres from the start, not added later once it's painful.
- **Structured logging + error tracking (Sentry or equivalent)** on every module from its first commit.
- **Stateless API processes** — no in-memory session state, no in-memory queue, no in-memory rate limiter — so the backend can run as 2+ instances behind a load balancer without code changes later.

---

## STEP 3 — The Park module (default logistics vendor)

The attached HTML describes a motor-park custody system — Park Hubs (physical terminals) and Park Agents (TrustOps-vetted staff) who log parcel arrivals, physically inspect parcels, and release them only against a system-generated 4-digit Handover PIN. This is a distinct concept from an ordinary logistics company (a courier with POCs who accept/ship/deliver end-to-end) — model both, don't conflate them, and build Park on top of the general logistics-company primitives rather than as a one-off:

- **Logistics companies** (general model): `logistics_companies`, `logistics_company_members` (POCs with `ADMIN`/`OPERATOR` roles, invite-is-pending/login-is-acceptance lifecycle, one active company per person via a partial unique index), `logistics_packages` + `logistics_package_status_events` for the accept/reject/ship/deliver pipeline. A seller's ship step shows every `ENABLED` company plus a permanent "arrange my own shipping" option — never removed.
- **"Park" is seeded as a row in `logistics_companies`**, flagged `isDefault: true` (partial unique index: at most one default company at a time) — it shows pinned first in the ship-step dropdown.
- A Park Agent is a `logistics_company_members` row on the Park company — same roles, same auth (`scope: 'LOGISTICS'`, its own login route), same invite lifecycle as any other company's POC. `park-agent-app` is a different frontend hitting the same auth, scoped server-side to Park-company membership only (never trust the client to self-select which company's data it sees).
- **New tables specific to custody** (additive, own migration):
  - `park_hubs` — physical terminal: name, operator business name, address, `status` (`PENDING`|`ACTIVE`|`SUSPENDED`), onboarding fields matching the HTML's registration flow (business basics → agent identity verification → park-authorization evidence with a mandatory photo gate → handling-fee/payout setup → review → submitted/pending).
  - `park_hub_agents` — which Park POCs are assigned to which hub, with independently grantable permission flags (`canReceive`, `canInspect`, `canRelease`, `canAddStaff`, `canManagePayouts`) — staff turnover at a hub must not corrupt custody history, hence its own join table, not a role enum.
  - `park_parcels` — one row per trade routed through Park (FK → trades, unique), FK to origin/destination `park_hubs`, status pipeline: `AWAITING_SOURCE_DROPOFF` → `AT_SOURCE_HUB` → `IN_TRANSIT` → `AT_DESTINATION_HUB` → `RELEASED`, plus an `EXCEPTION` branch (damage/seal-tamper) that freezes the trade.
  - `park_custody_events` — append-only: every scan/inspection/PIN-attempt with actor, timestamp, hub, photo reference (via the existing Cloudinary trade-asset pattern — don't add a new storage pool).
  - `park_handover_pins` — system-generated 4-digit PIN per parcel/leg: `pinHash` (never plaintext), `attemptsCount`/`maxAttempts`, `lockedAt` on exceeding attempts, `verifiedAt`.
  - A fixed ₦300/parcel platform rate, modeled as a config row (not a hardcoded literal, not a rate card or negotiable quote — no pricing flexibility beyond this single fixed fee).
- **Events**: `park.hub.created/activated/suspended`, `park.parcel.received/inspected/exception/released` — `park.parcel.released` is Park's equivalent of a courier's "delivered" signal and should feed the same buyer-confirms-or-auto-completes trade flow as ordinary deliveries once that flow exists; design the event shape for that now even if the trade-side consumption is a later ticket.
- **TrustOps side** (`operations-app`): Park Hub applications and custody exceptions use the same AI-suggests/human-decides pattern as every other TrustOps decision — advisory box → "a human decides, always" divider → action buttons → policy-cite footer. If the unified `.p0-shell` console (Work Queue / Universal Case / Custody Command Centre) is built by the time you reach this, add Park as a case type inside it rather than a bespoke screen.
- **`park-agent-app`**: its own mobile-first Next.js 15 app. Core screens per the HTML's Park Agent material: Hub Dashboard, Log Arrival (scan by Trade Code/waybill), Physical Inspection (seal intact/damaged/tampered + timestamped photo), Handover PIN entry + validation, PIN-mismatch failure state, damage/exception logging, and an earnings/withdrawal view matching the pattern used elsewhere for payouts.

---

## STEP 4 — UI fidelity across all five frontends

**Install and use the `frontend-design` skill** (plugin `anthropics/claude-plugins-official`, path `plugins/frontend-design`) for every screen, invoked per screen, not once at the start.

The attached HTML is the literal source of truth for layout, components, tokens, and brand marks — read a screen's surrounding prose too, not just its markup, since it's a living reference with explicit notes on what's new/closing-a-gap.

1. Before any screen work, extract the HTML's CSS custom properties into `packages/ui-kit` as the canonical token file every app imports — one source, not five copies.
2. Build shared primitives once in `ui-kit` (buttons, cards, the trade-row pattern, the TrustOps decision panel, the policy-cite footer) rather than per app.
3. Respect the stated responsive strategy: mobile is the baseline everywhere; only layouts that genuinely change shape at width get bespoke desktop treatments; tablet inherits the desktop shell with sidebar→top-nav. Breakpoints: base → `sm` 640px → `md` 768px → `lg` 1024px.
4. `park-agent-app` and the buyer/seller flows in `web-app-ui` are mobile-web (browser chrome, not a native app bezel) — keep them web, not native-feeling.
5. On every UI ticket, screenshot the built screen next to the matching section of the HTML reference and note any deviation before marking it done.

---

## STEP 5 — GitHub Actions scaffolding

Set this up as one of the first tickets, before feature work, so every subsequent ticket runs through CI from the start.

- One workflow per app under `.github/workflows/` (`backend-api.yml`, `web-app-ui.yml`, `operations-app.yml`, `logistics-ops.yml`, `park-agent-app.yml`), path-filtered to that app's directory plus the `packages/**` it depends on — a change to one app shouldn't trigger a build/deploy of the others.
- Each workflow: install (shared pnpm/turbo cache) → lint → typecheck → unit + integration tests → build. A `deploy` job depends on tests passing, runs only `if: github.ref == 'refs/heads/main'`, and targets that app's own destination — confirm the real hosting target rather than assuming one.
- A required migration-safety check for `backend-api` before any deploy job, given how much of this relies on partial unique indexes and schema-level invariants being exactly right.
- Given the "don't push `main` until every ticket is done" rule below: build and validate these workflows via `workflow_dispatch` on a feature branch as you go — the `deploy`-on-`main` jobs just won't have fired for real until the final push.

---

## STEP 6 — Ticket-based build process (governs how you work from here on)

1. **Brainstorm, then plan.** Use `superpowers:brainstorming` to pressure-test the Park module design and the fresh-monorepo approach above, then `superpowers:writing-plans` for a concrete, reviewable plan.
2. **First ticket: a short cannibalization audit.** Skim all four old repos under `/Users/emmanuelahman/Documents/projects/nykon-externals/kumtru/` (and their `.claude/` folders) specifically for pieces worth lifting as-is per Step 0's rule, and name them explicitly in the ticket list below rather than deciding ad hoc mid-build.
3. **Produce a publishable, numbered ticket list** covering: monorepo scaffolding, CI scaffolding, every module from the 20 conceptual specs, the Park subsystem above, and the specific open items already decided in `m2-logistics-module-spec.md`/`m8-payment-provider-adapter-plan.md` (reuse those decisions, e.g. pricing non-goals, state machine shapes — don't re-litigate them). Each ticket needs: a short title, the files/modules it touches, acceptance criteria, and dependencies. Write this to `docs/TICKETS.md` (or `docs/tickets/` if long) and treat it as the first deliverable — stop and let it be reviewed before executing, don't tunnel straight into code.
4. **Work the list ticket by ticket**: `superpowers:using-git-worktrees` to isolate each ticket's branch, `superpowers:subagent-driven-development`/`superpowers:executing-plans` to implement it, `superpowers:test-driven-development` throughout — tests are written as part of the ticket, not after.
5. **Before merging each ticket**, run `superpowers:requesting-code-review` (an AI review pass) and act on it via `superpowers:receiving-code-review`. Only once that's clean does the ticket merge **locally into `main`** via `superpowers:finishing-a-development-branch`.
6. Run `superpowers:verification-before-completion` at the end of each ticket (tests green, lint/typecheck clean, the UI screenshot-vs-reference check where applicable) before starting the next ticket.
7. **Hard constraint: do not `git push` to the shared remote until every ticket on the list is merged locally and verified.** Local commits/merges throughout are expected; the remote stays untouched until the very end, then one final review pass, then push.

---

## Definition of done

- Fresh monorepo, all five apps and shared packages building under one task runner — nothing imported wholesale from the old repos except pieces explicitly named in the cannibalization-audit ticket, each still covered by fresh tests.
- Branding is "Komtru" everywhere — domains, package names, UI copy, code identifiers, and the literal marks/tokens pulled from the HTML reference.
- GitHub Actions run (and pass) on every ticket's PR; deploy jobs exist and are validated via manual dispatch even though they haven't fired on `main` yet.
- Every screen in the attached HTML reference has a corresponding implemented screen in the correct app, visually checked against it.
- The Park module is fully modeled (schema, API, TrustOps review flow, mobile agent app) built on the general logistics-company primitives.
- Every API endpoint is paginated, rate-limited where it touches auth/PIN attempts, and idempotent where retries are plausible; every external I/O call is BullMQ-backed.
- The ticket list, and the state of each ticket, is visible in `docs/TICKETS.md`.
- `main` has not been pushed to the remote until this entire list is true.
