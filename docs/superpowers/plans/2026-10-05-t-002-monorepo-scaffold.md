# T-002 Monorepo Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An empty but fully wired pnpm + Turborepo monorepo where `pnpm turbo run lint typecheck test build` passes across five apps and four packages.

**Architecture:** Root workspace owns tooling only (Turbo, Husky, commitlint, lint-staged). `packages/config` exports shared TypeScript, ESLint, Prettier and Vitest presets that every workspace consumes. Each app and package is a placeholder with one real source file and one real test so every pipeline stage exercises something.

**Tech Stack:** pnpm 10.18, Node 22, Turborepo 2, TypeScript 5.9, ESLint 9 flat config with typescript-eslint 8, Prettier 3, Vitest 3, Husky 9, lint-staged 16, commitlint 19.

**Spec:** `docs/tickets/00-foundations.md` (T-002), `docs/superpowers/specs/2026-10-05-komtru-platform-design.md` §3.1, §4.1.

## Global Constraints

- Package scope `@komtru/*`. App package names: `@komtru/backend-api`, `@komtru/web-app-ui`, `@komtru/operations-app`, `@komtru/logistics-ops`, `@komtru/park-agent-app`. Package names: `@komtru/config`, `@komtru/shared-types`, `@komtru/ui-kit`, `@komtru/api-client`.
- Node `>=22 <23`, `packageManager: "pnpm@10.18.2"`, one root lockfile.
- Vitest is the only test runner. ESLint 9 flat config only.
- `docs/specs/backend-apis.env` and every `.env*` except `.env.example` stay git-ignored.
- Next.js, Tailwind and Express are NOT installed in this ticket; T-011, T-017, T-020 and T-110 add them. Placeholders are plain TypeScript.

## Review Focus

1. A workspace with no tests must not silently pass `test`: every placeholder ships one real test (Task 2).
2. A commit message like `fixed stuff` must be rejected by commitlint (Task 3 test).
3. The secrets file must remain ignored even if someone edits `.gitignore` carelessly: an automated check runs in `pnpm test` at the root (Task 3).
4. Lint must actually lint TypeScript with type information, not pass vacuously: a fixture with a floating promise must fail (Task 1 test).
5. `pnpm install` on a fresh clone must not need global tools beyond pnpm and Node (verified in Task 4).

---

### Task 1: Root workspace and `@komtru/config`

**Files:**

- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc` (`22`), `.npmrc` (`engine-strict=true`, `auto-install-peers=true`), `.editorconfig`, `.prettierrc.json` (re-exports config), `.prettierignore`, `eslint.config.mjs`
- Create: `packages/config/package.json`, `packages/config/tsconfig/{base,node,library}.json`, `packages/config/eslint/index.mjs`, `packages/config/prettier/index.json`, `packages/config/vitest/preset.ts`
- Test: `packages/config/test/eslint.test.ts`, `packages/config/test/fixtures/floating-promise.ts`

**Interfaces:**

- Produces: `@komtru/config/tsconfig/base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes: false`, ES2022, `moduleResolution: bundler`), `node.json` (extends base, `module: NodeNext`), `library.json` (extends base, `declaration: true`). `@komtru/config/eslint` default export `komtruEslint({ tsconfigRootDir, react?: boolean })` returning a flat-config array (typescript-eslint `recommendedTypeChecked` + prettier compat). `@komtru/config/vitest` exports `defineKomtruVitest(overrides)`.

- [ ] **Step 1: Write the failing test** — `eslint.test.ts`: lints `fixtures/floating-promise.ts` (`async function f(){}; f();`) with `komtruEslint` and asserts one message with ruleId `@typescript-eslint/no-floating-promises`; lints a clean fixture and asserts zero messages.
- [ ] **Step 2: Run** `pnpm --filter @komtru/config test` — expect FAIL (module not found).
- [ ] **Step 3: Implement** root manifests and the config package. Root scripts: `lint`, `typecheck`, `test`, `build` all delegate to `turbo run <task>`; `format` runs Prettier. `turbo.json` tasks: `build` (dependsOn `^build`, outputs `dist/**`), `lint`, `typecheck` (dependsOn `^build`), `test` (dependsOn `^build`).
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Commit** `chore(config): add workspace root and shared tooling presets`.

### Task 2: Placeholder apps and packages

**Files:**

- Create for each of `apps/{backend-api,web-app-ui,operations-app,logistics-ops,park-agent-app}` and `packages/{shared-types,ui-kit,api-client}`: `package.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `src/index.ts`, `test/index.test.ts`

**Interfaces:**

- Produces: each workspace exports `export const workspace = '<package name>' as const;` from `src/index.ts`; scripts `build` (`tsc -p tsconfig.json` to `dist/`), `lint` (`eslint .`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`).

- [ ] **Step 1: Write the failing tests** — each `test/index.test.ts` asserts `workspace` equals its package name.
- [ ] **Step 2: Run** `pnpm turbo run test` — expect FAIL.
- [ ] **Step 3: Implement** the placeholders.
- [ ] **Step 4: Run** `pnpm install && pnpm turbo run lint typecheck test build` — expect all 9 workspaces green (config included).
- [ ] **Step 5: Commit** `chore: scaffold five apps and three packages as placeholders`.

### Task 3: Commit hygiene and secret guard

**Files:**

- Create: `commitlint.config.mjs`, `.husky/pre-commit` (`pnpm exec lint-staged`), `.husky/commit-msg` (`pnpm exec commitlint --edit "$1"`), `lint-staged` block in root `package.json`, `scripts/check-secrets-ignored.mjs`
- Test: `scripts/test/commitlint.test.ts`, `scripts/test/secrets-ignored.test.ts`, `scripts/vitest.config.ts`

**Interfaces:**

- Produces: root script `test:repo` (runs `vitest run --config scripts/vitest.config.ts`), wired into root `test` after turbo.

- [ ] **Step 1: Write the failing tests** — commitlint: `feat(identity): add login` passes, `fixed stuff` fails. Secrets: `git check-ignore docs/specs/backend-apis.env`, `.env`, `apps/backend-api/.env` all exit 0; `apps/backend-api/.env.example` exits 1.
- [ ] **Step 2: Run** `pnpm test:repo` — expect FAIL.
- [ ] **Step 3: Implement** config, hooks and the check script (exits non-zero listing any path not ignored).
- [ ] **Step 4: Run** `pnpm test:repo` — expect PASS; make a throwaway commit with message `bad message` and confirm the hook rejects it.
- [ ] **Step 5: Commit** `chore: add commitlint, lint-staged hooks and secret-ignore guard`.

### Task 4: README and fresh-clone verification

**Files:**

- Create: `README.md` (layout, prerequisites Node 22 + pnpm 10, commands, ticket process pointer to `docs/TICKETS.md`)

- [ ] **Step 1:** Write README.
- [ ] **Step 2: Verify** in a temporary clone of the branch: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build` all succeed.
- [ ] **Step 3: Commit** `docs: add repository README`.
