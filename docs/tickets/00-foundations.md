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

- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-002-monorepo-scaffold.md`.
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

- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-003-local-infra.md`. Runbook: `docs/runbooks/local-dev.md`.
- **Touches:** `docker-compose.yml`, `scripts/env/{local-infra,populate-backend-env}.mjs`, `scripts/check-staged-secrets.mjs`, `.secretlintrc.json`, `.secretlintignore`, `apps/*/.env.example`, `.husky/pre-commit` (secret scan)
- **Depends on:** T-002
- **Acceptance criteria:**
  - `docker compose up` starts Postgres 16, PgBouncer in transaction mode in front of it, Redis 7 and Mailpit, all with health checks.
  - `pnpm env:backend` writes `apps/backend-api/.env` from `docs/specs/backend-apis.env`, keeping every value, except that the database name in `POSTGRES_URL` is replaced with `komtru_v2_dev` (design §3.4) and `POSTGRES_DIRECT_URL` is added. The script never prints values; it prints only the variable names it wrote.
  - `.env.example` files list every variable each app needs, with safe placeholders and a one-line description each.
  - A pre-commit secret scan (gitleaks or equivalent) blocks commits containing keys that match the `.env` value shapes; a test commit with a fake key is rejected.
  - Docs note the Paystack webhook URL must be repointed at cutover.

### T-004 — CI workflows per app

- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-004-ci-workflows.md`. Five workflows plus `.github/actions/setup`, which is the only place that knows about Node and pnpm: `pnpm/action-setup@v6` reads `packageManager` and `actions/setup-node@v7` reads `engines.node` through `node-version-file: package.json`, so neither version is restated in CI. Each job runs one `pnpm exec turbo run <task> --filter=@komtru/<app>`, so CI never re-states a script name an app's `package.json` already owns. `scripts/test/ci-workflows.test.ts` (72 assertions, part of `pnpm test:repo`) derives each workflow's path filter from the workspace dependency graph, so an app that gains a `workspace:*` dependency without a filter update fails the suite instead of being discovered on a push. The backend's `test` job runs Postgres, PgBouncer and Redis as service containers copied field-for-field from `docker-compose.yml` on the same published ports (55432 / 56432 / 56379, which the backend's own test helpers default to and `redis://localhost:56379`, which its integration tests hard-code), with `KOMTRU_INFRA_TESTS=1` so unit and integration tests run in one pass; the suite's Vitest `globalSetup` migrates the template database and creates `komtru_app`, so CI needs no separate `db:migrate` step. `deploy` is a single placeholder `echo` until T-005; T-022 adds the `migration-safety` job to the backend deploy's `needs`.
- **Validated with `act` 0.2.89** (installed for this ticket via Homebrew; its containers, volumes and image were removed afterwards and the local `komtru-*` stack was untouched):
  - `act --list` on all five workflows: each lists `lint`/`typecheck` at stage 0, `test` at 1, `build` at 2, `deploy` at 3, for `push`, `pull_request` and `workflow_dispatch`.
  - `act push -n` and `act workflow_dispatch -n` on all five: every job and step resolves and `deploy` is skipped, because the dry run's ref is this feature branch.
  - `act push -n -e {"ref":"refs/heads/main"}`: `deploy` runs and prints its placeholder — the `if: github.ref == 'refs/heads/main'` guard is exercised in both directions.
  - A real (not dry) `act push -j lint` of `logistics-ops` succeeded end to end: `pnpm/action-setup@v6` reported "Switching pnpm from v11.19.0 to v10.18.2", `actions/setup-node@v7` reported "Resolved package.json as >=22.12 <23" and acquired Node 22.23.3, `pnpm install --frozen-lockfile` finished in 8s, `turbo run lint --filter=@komtru/logistics-ops` reported "Tasks: 1 successful, 1 total", and both the Turbo and pnpm-store caches saved. That is the composite action proven end to end on a real runner image.
  - The backend `test` job could not be dry-run: `act` 0.2.89 panics (nil-pointer in `containerReference.GetHealth`, `pkg/runner/run_context.go:593`) whenever a plan contains a job with `services:` under `-n`. A copy of the workflow with only the `services:` block removed dry-runs clean through `deploy`, and the block itself is asserted field-by-field against `docker-compose.yml` by the Vitest suite. A real `act` run of that job was deliberately not attempted: it would bind host ports 55432/56432/56379, which the running local stack already holds.
- **Review fixes (2026-10-05):** the reviewer caught that Turborepo runs tasks in strict env mode, so `KOMTRU_INFRA_TESTS` set on the backend `test` job never reached the task — every `*.int.test.ts` suite would have skipped itself in CI while the job went green, with Postgres, PgBouncer and Redis running and untouched. `turbo.json`'s `test` task now declares the three `KOMTRU_TEST_*`/`KOMTRU_INFRA_TESTS` variables (and `KOMTRU_BROWSER_TESTS`), proven by running the backend suite with and without the declaration, and a test now fails if any job sets a variable `turbo.json` would drop. Also from that pass: `.github/workflows/repo.yml` runs the repository suite, the formatter and every workspace package unfiltered, closing the hole where `packages/ui-kit`, `packages/api-client` and `scripts/test/**` were under no workflow at all; `cancel-in-progress` no longer cancels a run on `main`, where a deploy may be in flight; the pin and credential scans now cover the composite action, which is where every third-party action actually lives; job `env` values must be a known throwaway literal or a `secrets`/`vars` expression; and the cache `restore-keys` are asserted to be real prefixes of the primary key rather than merely present.
- **Deferred:** remote `workflow_dispatch` validation (needs a push — see the question below); the backend `test` job's `services:` block is not exercised by `act` (upstream panic, above) and is only covered by the shape test; GitHub service containers take no `command`, so Redis runs without compose's `--appendonly yes` (nothing in the backend suite depends on Redis persistence); `edoburu/pgbouncer:latest` is a floating tag, which belongs with `docker-compose.yml` rather than here; T-022's `migration-safety` job does not exist yet and is flagged in a comment on the backend deploy job; third-party actions are pinned to major tags rather than commit SHAs, which is a supply-chain policy call for the owner.
- **Question for the owner (blocks the last acceptance criterion):** "May I push the branch `t-004-ci-workflows` — and only that branch, never `main` — to the GitHub remote, so the five workflows can be validated by a real `workflow_dispatch` run on GitHub? `docs/MASTER_BUILD_PROMPT.md` STEP 6.7 forbids pushing until every ticket is merged locally, and this checkout has no remote configured, so nothing has been pushed and the acceptance criterion is unmet until you answer. If yes, name the remote and confirm that pushing a feature branch (never `main`) is acceptable; if no, T-004 ships validated by `act` only and remote validation moves to the final push."
- **Touches:** `.github/workflows/{backend-api,web-app-ui,operations-app,logistics-ops,park-agent-app}.yml`, `.github/actions/setup/action.yml`, `scripts/test/ci-workflows.test.ts`
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
