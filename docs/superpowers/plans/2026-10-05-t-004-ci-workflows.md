# T-004 CI Workflows Per App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five path-filtered GitHub Actions workflows, one per app, that install → lint → typecheck → test → build → deploy, sharing one composite setup action, with the backend's integration tests running against Postgres, PgBouncer and Redis service containers.

**Architecture:** `.github/actions/setup/action.yml` is the only place that knows about Node, pnpm and the Turbo cache; every job in every workflow calls it and then runs one `turbo run <task> --filter=@komtru/<app>` command, so CI never re-states a script name the app's `package.json` already owns. Each workflow's `paths:` filter is the app plus the transitive closure of its `workspace:*` dependencies plus the few root files that change every build. A repo-level Vitest suite parses the YAML and asserts that shape, so a workflow that drifts from the workspace graph fails `pnpm test:repo` rather than being discovered on a push.

**Tech Stack:** GitHub Actions (composite action, service containers), `actions/checkout@v7`, `pnpm/action-setup@v6`, `actions/setup-node@v7`, `actions/cache@v6` (the current major of each, checked against the GitHub API), Turborepo 2.11, Vitest 5 with the `yaml` parser, `act` for local validation.

**Spec:** `docs/tickets/00-foundations.md` (T-004); `docs/MASTER_BUILD_PROMPT.md` STEP 5.

## Global Constraints

- Node and pnpm come from the root `package.json` only: `engines.node` is `>=22.12 <23` and `packageManager` is `pnpm@10.18.2`. No workflow may name a version itself.
- No literal secret value anywhere in `.github/**`. Real values are `${{ secrets.* }}`; the only literal credentials permitted are the throwaway container ones already in `docker-compose.yml` (`komtru:komtru`, `komtru_app:komtru_app`).
- `apps/backend-api/.env` is never read, printed or referenced by CI.
- `deploy` runs only `if: github.ref == 'refs/heads/main'` — that exact expression — and `needs` the `test` job.
- Service containers mirror `docker-compose.yml`: `postgres:16-alpine`, `edoburu/pgbouncer:latest` in transaction mode, `redis:7-alpine`, published on 55432 / 56432 / 56379 so the backend tests' hard-coded `redis://localhost:56379` and the `KOMTRU_TEST_*` defaults both resolve.
- Deploy bodies stay placeholders until T-005 (hosting target unconfirmed, design §12 Q1); the backend's `migration-safety` gate arrives with T-022, which depends on this ticket.
- Never `git push`. Remote `workflow_dispatch` validation is therefore out of scope and becomes a recorded question for the owner.

## Review Focus

1. A workflow that still passes after its app gains a new `workspace:*` dependency, because the path filter was written by hand and nobody updated it — the graph test must derive the expected filter from the manifests, not restate it (Task 2).
2. One app's change triggering another app's workflow: `apps/web-app-ui/**` must not appear in any filter but `web-app-ui.yml` (Task 2).
3. A CI-only change (the composite action, the workflow file itself) that nothing re-runs, so the workflow is only exercised the next time app code changes (Task 2 asserts both are in every filter).
4. `deploy` firing from a feature branch because someone widened the trigger: the `if:` guard is asserted as an exact string, and `workflow_dispatch` on a branch must not deploy (Task 2).
5. The backend test job going green without ever touching Postgres — `KOMTRU_INFRA_TESTS` unset means every `.int.test.ts` silently skips (`describe.runIf`), so the job must set it to `1` and the test asserts that (Task 3).

---

### Task 1: Composite setup action and its contract test

**Files:**

- Create: `.github/actions/setup/action.yml`
- Create: `scripts/test/ci-workflows.test.ts`
- Modify: root `package.json` (devDependency `yaml`), `pnpm-lock.yaml`

**Interfaces:**

- Produces: `./.github/actions/setup`, a composite action with no required inputs and one optional input `cache-key` (string, default `''`, appended to the Turbo cache key so sibling jobs can share or separate caches). It runs: `pnpm/action-setup@v6` (version from `packageManager`), `actions/setup-node@v7` with `node-version-file: package.json` and `cache: pnpm`, `pnpm install --frozen-lockfile`, and `actions/cache@v6` over `.turbo` keyed on the lockfile hash.
- Produces, for Tasks 2–3: `scripts/test/ci-workflows.test.ts` exports nothing but defines the shared helpers `readWorkflow(app)` and `APPS` (the five app directory names) used by the later tasks' tests in the same file.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/test/ci-workflows.test.ts
describe('composite setup action', () => {
  it('pins Node and pnpm from the root package.json rather than literals', () => {
    const setupNode = steps.find((s) => s.uses?.startsWith('actions/setup-node@'));
    expect(setupNode?.with?.['node-version-file']).toBe('package.json');
    expect(setupNode?.with?.['node-version']).toBeUndefined();
    const setupPnpm = steps.find((s) => s.uses?.startsWith('pnpm/action-setup@'));
    expect(setupPnpm?.with?.version).toBeUndefined();
    expect(JSON.stringify(action)).not.toContain('10.18.2');
  });

  it('restores the pnpm store and the Turbo cache', () => {
    expect(setupNode?.with?.cache).toBe('pnpm');
    const turbo = steps.find((s) => s.uses?.startsWith('actions/cache@'));
    expect(turbo?.with?.path).toContain('.turbo');
    expect(turbo?.with?.key).toContain("hashFiles('pnpm-lock.yaml')");
  });

  it('installs with a frozen lockfile', () => {
    expect(steps.some((s) => s.run?.includes('pnpm install --frozen-lockfile'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:repo ci-workflows`
Expected: FAIL — `.github/actions/setup/action.yml` does not exist (ENOENT).

- [ ] **Step 3: Add `yaml` to the root devDependencies and write `.github/actions/setup/action.yml`**

`pnpm add -w -D yaml`. The action's `runs.using` is `composite`; every `run` step needs `shell: bash`. Order matters: `pnpm/action-setup` before `actions/setup-node`, because setup-node's `cache: pnpm` shells out to `pnpm store path`.

- [ ] **Step 4: Run the test**

Run: `pnpm test:repo ci-workflows`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/actions/setup/action.yml scripts/test/ci-workflows.test.ts package.json pnpm-lock.yaml
git commit -m "ci: add the shared pnpm and turbo cache setup action"
```

---

### Task 2: The five workflows — triggers, path filters, job graph

**Files:**

- Create: `.github/workflows/{backend-api,web-app-ui,operations-app,logistics-ops,park-agent-app}.yml`
- Modify: `scripts/test/ci-workflows.test.ts`

**Interfaces:**

- Consumes: `./.github/actions/setup` from Task 1.
- Produces: in every workflow, jobs named `lint`, `typecheck`, `test`, `build`, `deploy`. `test` needs `[lint, typecheck]`; `build` needs `test`; `deploy` needs `[test, build]`. Each job runs `pnpm exec turbo run <task> --filter=@komtru/<app>`.

- [ ] **Step 1: Write the failing tests**

```ts
const workspaceDeps = (pkgName: string): Set<string> => /* transitive closure over workspace:* deps */;

describe.each(APPS)('%s workflow', (app) => {
  it('is path-filtered to the app, its workspace dependencies and the shared root files', () => {
    const expected = new Set([
      `apps/${app}/**`,
      ...[...workspaceDeps(`@komtru/${app}`)].map((dir) => `packages/${dir}/**`),
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'turbo.json',
      `.github/workflows/${app}.yml`,
      '.github/actions/setup/**',
    ]);
    expect(new Set(workflow.on.push.paths)).toEqual(expected);
    expect(new Set(workflow.on.pull_request.paths)).toEqual(expected);
  });

  it('does not trigger on another app or an unrelated package', () => {
    for (const other of APPS.filter((a) => a !== app)) {
      expect(paths.some((p) => p.startsWith(`apps/${other}/`))).toBe(false);
    }
    for (const pkg of packagesNotDependedOn) {
      expect(paths.some((p) => p.startsWith(`packages/${pkg}/`))).toBe(false);
    }
  });

  it('is triggerable by workflow_dispatch', () => {
    expect(workflow.on).toHaveProperty('workflow_dispatch');
  });

  it('runs install, lint, typecheck, test, build and deploy in that order', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['lint', 'typecheck', 'test', 'build', 'deploy']);
    expect(workflow.jobs.test.needs).toEqual(['lint', 'typecheck']);
    expect(workflow.jobs.build.needs).toEqual('test');
    expect(every job's steps).toContain({ uses: './.github/actions/setup' });
  });

  it('deploys only from main and only after the tests', () => {
    expect(workflow.jobs.deploy.needs).toContain('test');
    expect(workflow.jobs.deploy.if).toBe("github.ref == 'refs/heads/main'");
  });

  it('filters turbo to this app alone', () => {
    for (const task of ['lint', 'typecheck', 'test', 'build'])
      expect(runOf(task)).toContain(`turbo run ${task} --filter=@komtru/${app}`);
  });

  it('reads tokens only from secrets and contains no literal credential', () => {
    expect(text).not.toMatch(/sk_(live|test)_|-----BEGIN |ghp_|AKIA[0-9A-Z]{16}/);
    expect(literalPasswordsIn(text)).toEqual(passwordsIn('docker-compose.yml'));
  });

  it('pins every third-party action to a major version tag', () => {
    for (const uses of usesValues.filter((u) => !u.startsWith('./')))
      expect(uses).toMatch(/@v\d+$/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm test:repo ci-workflows`
Expected: FAIL — five missing workflow files.

- [ ] **Step 3: Write the five workflows**

Each: `name`, `on` (`push` restricted to `branches: [main]` with the paths, `pull_request` with the same paths, `workflow_dispatch`), `permissions: contents: read`, a `concurrency` group keyed on workflow + ref that cancels in-progress runs, then the five jobs on `ubuntu-latest`. `deploy`'s body is a single `echo` naming the app and pointing at T-005; the backend's carries a comment that T-022 adds `migration-safety` to its `needs`.

- [ ] **Step 4: Run the tests**

Run: `pnpm test:repo ci-workflows`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows scripts/test/ci-workflows.test.ts
git commit -m "ci: add per-app github actions workflows"
```

---

### Task 3: Backend service containers and the integration-test environment

**Files:**

- Modify: `.github/workflows/backend-api.yml`, `scripts/test/ci-workflows.test.ts`

**Interfaces:**

- Consumes: `apps/backend-api/test/support/db-urls.ts` — `KOMTRU_TEST_DIRECT_URL` (owner, straight to Postgres), `KOMTRU_TEST_POOLED_URL` (`komtru_app` through PgBouncer), and `infraEnabled` keyed on `KOMTRU_INFRA_TESTS === '1'`. The template database and the `komtru_app` role are created by the suite's own `globalSetup`, so CI needs no migrate step.

- [ ] **Step 1: Write the failing tests**

```ts
describe('backend-api workflow services', () => {
  it('runs the three compose services on the ports the tests expect', () => {
    expect(services.postgres.image).toBe('postgres:16-alpine');
    expect(services.pgbouncer.image).toBe('edoburu/pgbouncer:latest');
    expect(services.redis.image).toBe('redis:7-alpine');
    expect(services.postgres.ports).toEqual(['55432:5432']);
    expect(services.pgbouncer.ports).toEqual(['56432:5432']);
    expect(services.redis.ports).toEqual(['56379:6379']);
  });

  it('matches docker-compose on credentials, database and pool mode', () => {
    expect(services.postgres.env).toMatchObject(composeEnv('postgres'));
    expect(services.pgbouncer.env).toMatchObject({ DB_HOST: 'postgres', POOL_MODE: 'transaction' });
  });

  it('health-checks every service so the job waits for them', () => {
    for (const s of Object.values(services)) expect(s.options).toContain('--health-cmd');
  });

  it('turns the integration tests on and points them at the services', () => {
    expect(env.KOMTRU_INFRA_TESTS).toBe('1');
    expect(env.KOMTRU_TEST_DIRECT_URL).toBe('postgresql://komtru:komtru@localhost:55432');
    expect(env.KOMTRU_TEST_POOLED_URL).toBe('postgresql://komtru_app:komtru_app@localhost:56432');
  });

  it('gives only the backend workflow service containers', () => {
    for (const app of APPS.filter((a) => a !== 'backend-api'))
      expect(workflowOf(app).jobs.test.services).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm test:repo ci-workflows`
Expected: FAIL — `services` undefined on the backend `test` job.

- [ ] **Step 3: Add the `services:` block and the test job's `env:`**

GitHub service containers share one network and resolve each other by service id, so PgBouncer's `DB_HOST` is literally `postgres`; the runner reaches them on the published ports. Health options use the compose commands (`pg_isready -U komtru -d komtru_v2_dev`, `nc -z 127.0.0.1 5432`, `redis-cli ping`).

- [ ] **Step 4: Run the tests**

Run: `pnpm test:repo ci-workflows`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/backend-api.yml scripts/test/ci-workflows.test.ts
git commit -m "ci: run postgres, pgbouncer and redis for backend integration tests"
```

---

### Task 4: Local validation with `act`, and the ticket record

**Files:**

- Modify: `docs/tickets/00-foundations.md` (T-004 `Status`, `Deferred`, owner question)

- [ ] **Step 1: Install `act` once**

Run: `brew install act`. If brew is absent, the install fails, or it asks for sudo: stop, and record "not validated with `act`, and why" on the Deferred line instead of fighting it.

- [ ] **Step 2: Parse every workflow with `act`**

Run: `act --list -W .github/workflows/<file>` for each of the five.
Expected: the job table lists `lint`, `typecheck`, `test`, `build`, `deploy` with their stage numbers; a YAML or schema error is a failure to fix.

- [ ] **Step 3: Dry-run each workflow**

Run: `act push -n -W .github/workflows/<file>` and `act workflow_dispatch -n -W .github/workflows/<file>`.
Expected: every job and step resolves; `deploy` is skipped on a non-`main` ref. Capture the output for the report.

- [ ] **Step 4: Confirm `act` left nothing behind**

Run: `docker ps -a --filter name=act-` and `docker volume ls`.
Expected: no `act-*` container or volume; the four `komtru-*` containers are untouched and still running.

- [ ] **Step 5: Verify the repository**

Run: `pnpm exec turbo run build lint typecheck test --force`, then `pnpm exec prettier --check .`
Expected: both pass.

- [ ] **Step 6: Record the ticket**

Under `### T-004 — CI workflows per app`, add `- **Status:** Done (2026-10-05). Plan: …`, a `- **Deferred:** …` line covering whatever `act` could not do and the repo-level suite having no workflow of its own, and the verbatim question the owner must answer about pushing a branch for remote `workflow_dispatch` validation.

- [ ] **Step 7: Commit**

```bash
git add docs/tickets/00-foundations.md
git commit -m "docs(tickets): mark T-004 done and record the push question"
```
