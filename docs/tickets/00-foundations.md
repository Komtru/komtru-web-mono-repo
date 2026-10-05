# Epic 00 — Foundations

Every ticket in this file runs before feature work. Design reference: `docs/superpowers/specs/2026-10-05-komtru-platform-design.md` (cited below as "design §n").

---

### T-001 — Cannibalization audit

- **Status:** Done (2026-10-05, during planning)
- **Touches:** `docs/superpowers/specs/2026-10-05-komtru-platform-design.md` §11, this file
- **Depends on:** none
- **Outcome:** All four old repos and their `.claude/` folders were skimmed. The `.claude/` folders hold only local permission settings, so there are no codified conventions to inherit. Eight pieces are approved for verbatim lifting, each assigned to the ticket that will re-test and re-review it:

| Old path (`kumtru/backend-apis/src/modules/…`)                                                     | Lifted in |
| -------------------------------------------------------------------------------------------------- | --------- |
| `identity/domain/username/skeleton.ts`, `reserved.ts`                                              | T-033     |
| `utils/encryption.ts`                                                                              | T-026     |
| `identity/infrastructure/crypto.ts`                                                                | T-026     |
| `identity/domain/identifiers.ts`                                                                   | T-026     |
| `identity/domain/credential/hashing.ts`, `breach.ts`                                               | T-032     |
| `files/infrastructure/cloudinary.ts`, `files/domain/rotation.ts`, `files/domain/pools.ts`          | T-040     |
| `ledger/domain/providerAdapter.ts`, `ledger/infrastructure/providers/paystack/{client,webhook}.ts` | T-071     |
| `scheduler/domain/registry.ts`, `scheduler/infrastructure/queue.ts`                                | T-023     |

- **Rule for every lift:** the receiving ticket copies only that file, adapts imports, writes fresh tests (the old tests are not copied), notes "cannibalized from …" in the file header and the commit message, and goes through the same review pass as new code.

---

### T-002 — Monorepo scaffold and shared config

- **Touches:** `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.npmrc`, `packages/config/**`, `.husky/**`, `commitlint.config.mjs`, `.editorconfig`, `README.md`, empty `apps/*` and `packages/*` with placeholder `package.json`
- **Depends on:** T-001
- **Decisions recorded here:** pnpm everywhere (the backend leaves Yarn), Turborepo, Node 22, Vitest, ESLint 9 flat config plus Prettier 3 (design §3.1).
- **Acceptance criteria:**
  - `pnpm install` at the root succeeds with a single lockfile; `pnpm turbo run lint typecheck test build` runs across all workspaces and passes on the empty scaffold.
  - `packages/config` exports: base, node, library (NodeNext, so emitted output loads in Node and in bundlers) and next `tsconfig`s; one type-aware ESLint flat config, `komtruEslint`, used by every workspace; Prettier config; a Vitest preset. Two pieces belong to the tickets that install their tools: the Tailwind v4 preset is created in T-011, and the Next.js and React lint rules are added to `komtruEslint` in T-017.
  - Package names use the `@komtru/*` scope; app names are `@komtru/backend-api`, `@komtru/web-app-ui`, `@komtru/operations-app`, `@komtru/logistics-ops`, `@komtru/park-agent-app`.
  - Husky runs lint-staged on commit and commitlint (conventional commits) on the message.
  - `.gitignore` keeps `docs/specs/backend-apis.env` and every `.env*` except `.env.example` ignored; a test script asserts `git check-ignore docs/specs/backend-apis.env` succeeds.
  - Root `README.md` explains layout, prerequisites and the common commands.

### T-003 — Local infrastructure and environment wiring

- **Touches:** `docker-compose.yml`, `infra/pgbouncer/*`, `apps/backend-api/.env.example`, `apps/*/.env.example`, `scripts/env/populate-backend-env.ts`, `.husky/pre-commit` (secret scan)
- **Depends on:** T-002
- **Acceptance criteria:**
  - `docker compose up` starts Postgres 16, PgBouncer in transaction mode in front of it, Redis 7 and Mailpit, all with health checks.
  - `pnpm env:backend` writes `apps/backend-api/.env` from `docs/specs/backend-apis.env`, keeping every value, except that the database name in `POSTGRES_URL` is replaced with `komtru_v2_dev` (design §3.4) and `POSTGRES_DIRECT_URL` is added. The script never prints values; it prints only the variable names it wrote.
  - `.env.example` files list every variable each app needs, with safe placeholders and a one-line description each.
  - A pre-commit secret scan (gitleaks or equivalent) blocks commits containing keys that match the `.env` value shapes; a test commit with a fake key is rejected.
  - Docs note the Paystack webhook URL must be repointed at cutover.

### T-004 — CI workflows per app

- **Touches:** `.github/workflows/{backend-api,web-app-ui,operations-app,logistics-ops,park-agent-app}.yml`, `.github/actions/setup/action.yml`
- **Depends on:** T-002
- **Acceptance criteria:**
  - Five workflows, each path-filtered to its app plus the `packages/**` it depends on, each also triggerable by `workflow_dispatch`.
  - Shared composite action restores the pnpm store and Turbo cache.
  - Stages: install → lint → typecheck → unit and integration tests → build → deploy. The backend workflow runs Postgres, PgBouncer and Redis as service containers.
  - `deploy` needs the test job and runs only `if: github.ref == 'refs/heads/main'`; it calls a placeholder step until T-005.
  - Every workflow is validated locally with `act` and the run output is attached to the ticket.
  - Remote `workflow_dispatch` validation on a feature branch requires pushing that branch, which the no-push rule forbids. The ticket asks the owner before any push and records the answer.

### T-005 — Hosting confirmation and real deploy jobs

- **Status:** Blocked on design §12 Q1 (hosting targets and GitHub remote)
- **Touches:** deploy steps in each workflow, `apps/*/Dockerfile`, `apps/backend-api/ecosystem.config.cjs`, `docs/runbooks/deploy.md`
- **Depends on:** T-004, owner answer to Q1
- **Acceptance criteria:**
  - Each app deploys to its own confirmed destination; backend deploy waits for `migration-safety` (T-022).
  - The backend ships API and worker as separate processes.
  - Each deploy job passes a `workflow_dispatch` dry run.
  - The runbook covers rollback, migration order and secret provisioning.

### T-006 — Build-agent tooling prerequisites

- **Touches:** `docs/runbooks/dev-setup.md`, `docs/design-reference/SCREEN_INDEX.md` (verify)
- **Depends on:** T-002
- **Acceptance criteria:**
  - The `frontend-design` skill (plugin `anthropics/claude-plugins-official`, path `plugins/frontend-design`) is installed and confirmed loadable in the build session; it is not installed today.
  - Playwright browsers are installed for the visual-check harness.
  - `SCREEN_INDEX.md` (generated during planning) is verified against the HTML: 210 screens, each mapped to one app and one ticket.
