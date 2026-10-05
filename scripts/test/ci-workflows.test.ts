// Shape tests for the per-app GitHub Actions workflows (T-004). CI is configuration, so the only
// thing a test can hold it to is its shape: the path filters have to follow the workspace graph, the
// job graph has to gate deploy behind the tests, and the backend's service containers have to match
// docker-compose.yml and the ports the backend's own test helpers expect.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { LOCAL_APP_ROLE, LOCAL_DATABASE, LOCAL_PORTS } from '../env/local-infra.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
const read = (relative: string) => readFileSync(resolve(repoRoot, relative), 'utf8');
const readYaml = <T>(relative: string): T => parse(read(relative)) as T;

type Step = { uses?: string; run?: string; with?: Record<string, string>; name?: string };
type CompositeAction = { inputs?: Record<string, unknown>; runs: { using: string; steps: Step[] } };

const action = readYaml<CompositeAction>('.github/actions/setup/action.yml');
const actionSteps = action.runs.steps;
const stepUsing = (prefix: string) => actionSteps.find((step) => step.uses?.startsWith(prefix));

describe('composite setup action', () => {
  it('is a composite action every workflow can call as ./.github/actions/setup', () => {
    expect(action.runs.using).toBe('composite');
    for (const step of actionSteps) {
      if (step.run !== undefined) expect(step).toHaveProperty('shell', 'bash');
    }
  });

  it('takes Node and pnpm from the root package.json instead of naming versions', () => {
    const setupNode = stepUsing('actions/setup-node@');
    expect(setupNode?.with?.['node-version-file']).toBe('package.json');
    expect(setupNode?.with?.['node-version']).toBeUndefined();
    expect(stepUsing('pnpm/action-setup@')?.with?.version).toBeUndefined();
    const manifest = JSON.parse(read('package.json')) as {
      packageManager: string;
      engines: { node: string };
    };
    const text = read('.github/actions/setup/action.yml');
    expect(text).not.toContain(manifest.packageManager.replace('pnpm@', ''));
    expect(text).not.toContain(manifest.engines.node);
  });

  it('installs pnpm before setup-node, which needs it to find the store', () => {
    const pnpmIndex = actionSteps.findIndex((step) => step.uses?.startsWith('pnpm/action-setup@'));
    const nodeIndex = actionSteps.findIndex((step) => step.uses?.startsWith('actions/setup-node@'));
    expect(pnpmIndex).toBeGreaterThanOrEqual(0);
    expect(pnpmIndex).toBeLessThan(nodeIndex);
  });

  it('restores the pnpm store and the Turbo cache', () => {
    expect(stepUsing('actions/setup-node@')?.with?.cache).toBe('pnpm');
    const turboCache = stepUsing('actions/cache@');
    expect(turboCache?.with?.path).toContain('.turbo');
    const key = turboCache?.with?.key ?? '';
    expect(key).toContain("hashFiles('pnpm-lock.yaml')");
    // A restore key that is not a prefix of the primary key never matches, which would look like a
    // working cache and behave like none at all.
    const restoreKeys = (turboCache?.with?.['restore-keys'] ?? '').split('\n').filter(Boolean);
    expect(restoreKeys.length).toBeGreaterThan(0);
    for (const restoreKey of restoreKeys) {
      expect(key.startsWith(restoreKey), `${restoreKey} is not a prefix of ${key}`).toBe(true);
      expect(restoreKey.length).toBeLessThan(key.length);
    }
  });

  it('installs with a frozen lockfile', () => {
    expect(actionSteps.some((step) => step.run?.includes('pnpm install --frozen-lockfile'))).toBe(true);
  });
});

type Manifest = {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
type Job = {
  'runs-on': string;
  needs?: string | string[];
  if?: string;
  'runs-on'?: string;
  env?: Record<string, string>;
  services?: Record<
    string,
    { image: string; env?: Record<string, string>; ports?: string[]; options?: string }
  >;
  steps: Step[];
};
type Workflow = {
  name: string;
  on: {
    push?: { branches?: string[]; paths?: string[] };
    pull_request?: { paths?: string[] };
    workflow_dispatch?: unknown;
  };
  permissions?: Record<string, string>;
  concurrency?: { group: string; 'cancel-in-progress': boolean | string };
  jobs: Record<string, Job>;
};

const dirsOf = (group: 'apps' | 'packages') =>
  readdirSync(resolve(repoRoot, group), { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(resolve(repoRoot, group, entry.name, 'package.json')),
    )
    .map((entry) => entry.name)
    .sort();

const APPS = dirsOf('apps');
const PACKAGES = dirsOf('packages');

/** Every workspace manifest, keyed by package name, with the directory it lives in. */
const manifests = new Map<string, { group: 'apps' | 'packages'; dir: string; manifest: Manifest }>();
for (const group of ['apps', 'packages'] as const) {
  for (const dir of dirsOf(group)) {
    const manifest = JSON.parse(read(`${group}/${dir}/package.json`)) as Manifest;
    manifests.set(manifest.name, { group, dir, manifest });
  }
}

/** The `packages/` directories an app needs, transitively, through `workspace:*` dependencies. */
const packageDependenciesOf = (packageName: string): Set<string> => {
  const found = new Set<string>();
  const seen = new Set<string>();
  const walk = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const entry = manifests.get(name);
    if (!entry) return;
    if (name !== packageName && entry.group === 'packages') found.add(entry.dir);
    const deps = { ...entry.manifest.dependencies, ...entry.manifest.devDependencies };
    for (const [dependency, range] of Object.entries(deps)) {
      if (range.startsWith('workspace:')) walk(dependency);
    }
  };
  walk(packageName);
  return found;
};

const workflows = new Map(APPS.map((app) => [app, readYaml<Workflow>(`.github/workflows/${app}.yml`)]));
const workflowText = new Map(APPS.map((app) => [app, read(`.github/workflows/${app}.yml`)]));
const asArray = (value: string | string[] | undefined) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

describe.each(APPS)('%s workflow', (app) => {
  const workflow = workflows.get(app)!;
  const jobs = workflow.jobs;

  it('has a manifest named after its directory, which the filter derivation relies on', () => {
    expect(manifests.has(`@komtru/${app}`)).toBe(true);
  });

  it('is path-filtered to the app, its workspace dependencies and the shared root files', () => {
    const expected = new Set([
      `apps/${app}/**`,
      ...[...packageDependenciesOf(`@komtru/${app}`)].map((dir) => `packages/${dir}/**`),
      'package.json',
      'pnpm-lock.yaml',
      '.npmrc',
      'pnpm-workspace.yaml',
      'turbo.json',
      `.github/workflows/${app}.yml`,
      '.github/actions/setup/**',
    ]);
    expect(new Set(workflow.on.push?.paths)).toEqual(expected);
    expect(new Set(workflow.on.pull_request?.paths)).toEqual(expected);
  });

  it('does not run when another app or an unrelated package changes', () => {
    const paths = workflow.on.push?.paths ?? [];
    for (const other of APPS.filter((name) => name !== app)) {
      expect(paths.some((path) => path.startsWith(`apps/${other}/`))).toBe(false);
    }
    const needed = packageDependenciesOf(`@komtru/${app}`);
    for (const pkg of PACKAGES.filter((name) => !needed.has(name))) {
      expect(paths.some((path) => path.startsWith(`packages/${pkg}/`))).toBe(false);
    }
  });

  it('can be triggered by hand', () => {
    expect(workflow.on).toHaveProperty('workflow_dispatch');
  });

  it('pushes only from main, so deploy cannot fire from a feature branch', () => {
    expect(workflow.on.push?.branches).toEqual(['main']);
  });

  it('runs lint, typecheck, test, build and deploy in that order', () => {
    const expected = ['lint', 'typecheck', 'test', 'build', 'deploy'];
    // Only the backend has a schema to protect, so T-022's gate belongs to it alone.
    if (app === 'backend-api') expected.splice(3, 0, 'migration-safety');
    expect(Object.keys(jobs)).toEqual(expected);
    expect(asArray(jobs.test?.needs).sort()).toEqual(['lint', 'typecheck']);
    expect(asArray(jobs.build?.needs)).toEqual(['test']);
  });

  it('installs through the shared composite action in every job that builds', () => {
    for (const name of ['lint', 'typecheck', 'test', 'build']) {
      const steps = jobs[name]!.steps;
      expect(steps[0]?.uses).toMatch(/^actions\/checkout@v\d+$/);
      expect(steps.some((step) => step.uses === './.github/actions/setup')).toBe(true);
    }
  });

  it('runs each turbo task filtered to this app alone', () => {
    for (const task of ['lint', 'typecheck', 'test', 'build']) {
      const runs = jobs[task]!.steps.map((step) => step.run ?? '').join('\n');
      expect(runs).toContain(`turbo run ${task} --filter=@komtru/${app}`);
    }
  });

  it('deploys only from main, only after the tests, and only a placeholder until T-005', () => {
    expect(asArray(jobs.deploy?.needs)).toContain('test');
    if (app === 'backend-api') expect(asArray(jobs.deploy?.needs)).toContain('migration-safety');
    expect(jobs.deploy?.if).toBe("github.ref == 'refs/heads/main'");
    expect(jobs.deploy?.steps).toHaveLength(1);
    expect(jobs.deploy?.steps[0]?.run).toContain('T-005');
  });

  it('never cancels a run on main, where a deploy may be in flight', () => {
    expect(workflow.concurrency?.group).toContain('github.ref');
    // A second merge must not kill the first merge's deploy half-way through (T-005 gives deploy a
    // body); superseding a feature branch's run is still fine.
    expect(String(workflow.concurrency?.['cancel-in-progress'])).toContain("github.ref != 'refs/heads/main'");
  });

  it('asks for no more than read access to the repository', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  it('gives every job a runner', () => {
    for (const [name, job] of Object.entries(jobs)) {
      expect(job['runs-on'], name).toBeTruthy();
    }
  });
});

/**
 * The composite action is where every third-party action actually lives, so the pin and credential
 * scans have to cover it too — scanning only the five workflows left the one file that matters out.
 */
const scannedFiles = [
  ...APPS.map((app) => [`.github/workflows/${app}.yml`, workflowText.get(app)!] as const),
  ['.github/actions/setup/action.yml', read('.github/actions/setup/action.yml')] as const,
  ['.github/workflows/repo.yml', read('.github/workflows/repo.yml')] as const,
];

/**
 * An app workflow only runs when its own filter matches, so anything outside every filter — a
 * package no app imports yet, the repo-level suite, formatting — would otherwise have no CI at all.
 */
describe('repo-wide workflow', () => {
  const workflow = readYaml<Workflow>('.github/workflows/repo.yml');
  const runs = Object.values(workflow.jobs)
    .flatMap((job) => job.steps.map((step) => step.run ?? ''))
    .join('\n');

  it('filters nothing, so no path can fall between the app workflows', () => {
    expect(workflow.on.push?.paths).toBeUndefined();
    expect(workflow.on.pull_request?.paths).toBeUndefined();
    expect(workflow.on).toHaveProperty('workflow_dispatch');
  });

  it('runs the repository suite, the formatter and every workspace package unfiltered', () => {
    expect(runs).toContain('pnpm test:repo');
    expect(runs).toContain('pnpm format:check');
    expect(runs).toMatch(/turbo run (?!.*--filter)/);
  });

  it('covers the packages no app depends on yet', () => {
    const appFiltered = new Set(
      APPS.flatMap((app) => readYaml<Workflow>(`.github/workflows/${app}.yml`).on.push?.paths ?? []),
    );
    const uncovered = PACKAGES.filter((pkg) => !appFiltered.has(`packages/${pkg}/**`));
    // Whatever is uncovered today, this workflow is what runs it.
    expect(uncovered.length === 0 || runs.includes('turbo run')).toBe(true);
  });
});

describe.each(scannedFiles)('%s', (_path, text) => {
  it('carries no literal credential beyond the throwaway container ones', () => {
    expect(text).not.toMatch(/sk_(live|test)_|-----BEGIN |ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}/);
    const credentials = [...text.matchAll(/:\/\/([^/\s:]+):([^@\s]+)@/g)].map(
      (match) => `${match[1]}:${match[2]}`,
    );
    for (const credential of credentials) {
      expect([
        `${LOCAL_DATABASE.user}:${LOCAL_DATABASE.password}`,
        `${LOCAL_APP_ROLE.user}:${LOCAL_APP_ROLE.password}`,
      ]).toContain(credential);
    }
  });

  it('pins every third-party action to a major version tag', () => {
    const uses = [...text.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1]!);
    for (const reference of uses.filter((value) => !value.startsWith('./'))) {
      expect(reference).toMatch(/@v\d+$/);
    }
  });
});

describe('job environment', () => {
  /** Only these may appear as a literal; anything else has to come from secrets or vars. */
  const allowedLiterals = new Set([
    '1',
    'true',
    `postgresql://${LOCAL_DATABASE.user}:${LOCAL_DATABASE.password}@localhost:${LOCAL_PORTS.postgres}`,
    `postgresql://${LOCAL_APP_ROLE.user}:${LOCAL_APP_ROLE.password}@localhost:${LOCAL_PORTS.pgbouncer}`,
  ]);

  it.each(APPS)('%s sets only throwaway literals or secrets expressions', (app) => {
    const workflow = readYaml<Workflow>(`.github/workflows/${app}.yml`);
    for (const [name, job] of Object.entries(workflow.jobs)) {
      for (const [key, value] of Object.entries(job.env ?? {})) {
        const literal = String(value);
        const fromSecrets = /\$\{\{\s*(secrets|vars)\./.test(literal);
        expect(
          fromSecrets || allowedLiterals.has(literal),
          `${app}/${name} env ${key} is a literal that is neither throwaway nor a secrets expression`,
        ).toBe(true);
      }
    }
  });

  /**
   * Turborepo runs tasks in strict env mode: a variable a task does not declare is simply absent
   * inside it. A job that sets one and a turbo.json that does not declare it is the silent failure
   * this test exists to catch — the backend's integration suites would skip and the job stay green.
   */
  it('declares every variable a job sets in turbo.json, so the task actually receives it', () => {
    const turbo = JSON.parse(read('turbo.json')) as {
      globalEnv?: string[];
      globalPassThroughEnv?: string[];
      tasks: Record<string, { env?: string[]; passThroughEnv?: string[] }>;
    };
    for (const app of APPS) {
      const workflow = readYaml<Workflow>(`.github/workflows/${app}.yml`);
      for (const [name, job] of Object.entries(workflow.jobs)) {
        const task = /turbo run (\w+)/.exec(job.steps.map((step) => step.run ?? '').join('\n'))?.[1];
        if (!task) continue;
        const declared = new Set([
          ...(turbo.globalEnv ?? []),
          ...(turbo.globalPassThroughEnv ?? []),
          ...(turbo.tasks[task]?.env ?? []),
          ...(turbo.tasks[task]?.passThroughEnv ?? []),
        ]);
        for (const key of Object.keys(job.env ?? {})) {
          expect(declared, `${app}/${name} sets ${key}, which turbo.json's "${task}" task drops`).toContain(
            key,
          );
        }
      }
    }
  });
});

type ComposeService = { image: string; environment?: Record<string, string> };
const compose = readYaml<{ services: Record<string, ComposeService> }>('docker-compose.yml');
const backendTest = workflows.get('backend-api')!.jobs.test!;
const services = backendTest.services ?? {};

describe('backend-api service containers', () => {
  it('runs the same images as docker-compose', () => {
    for (const name of ['postgres', 'pgbouncer', 'redis']) {
      expect(services[name]?.image).toBe(compose.services[name]?.image);
    }
  });

  it('publishes them on the ports the backend tests look for', () => {
    expect(services.postgres?.ports).toEqual([`${LOCAL_PORTS.postgres}:5432`]);
    expect(services.pgbouncer?.ports).toEqual([`${LOCAL_PORTS.pgbouncer}:5432`]);
    expect(services.redis?.ports).toEqual([`${LOCAL_PORTS.redis}:6379`]);
  });

  it('keeps the compose credentials, database and pooling mode', () => {
    expect(services.postgres?.env).toEqual(compose.services.postgres?.environment);
    expect(services.pgbouncer?.env).toEqual(compose.services.pgbouncer?.environment);
    expect(services.pgbouncer?.env?.POOL_MODE).toBe('transaction');
    expect(services.postgres?.env?.POSTGRES_DB).toBe(LOCAL_DATABASE.name);
  });

  it('health-checks every service, so the job waits for them', () => {
    for (const name of ['postgres', 'pgbouncer', 'redis']) {
      expect(services[name]?.options).toContain('--health-cmd');
      expect(services[name]?.options).toContain('--health-retries');
    }
  });

  it('turns the integration tests on and points them at those services', () => {
    expect(backendTest.env?.KOMTRU_INFRA_TESTS).toBe('1');
    expect(backendTest.env?.KOMTRU_TEST_DIRECT_URL).toBe(
      `postgresql://${LOCAL_DATABASE.user}:${LOCAL_DATABASE.password}@localhost:${LOCAL_PORTS.postgres}`,
    );
    expect(backendTest.env?.KOMTRU_TEST_POOLED_URL).toBe(
      `postgresql://${LOCAL_APP_ROLE.user}:${LOCAL_APP_ROLE.password}@localhost:${LOCAL_PORTS.pgbouncer}`,
    );
  });

  it('matches the defaults the backend test helpers fall back to', () => {
    const helper = read('apps/backend-api/test/support/db-urls.ts');
    expect(helper).toContain(`?? '${backendTest.env?.KOMTRU_TEST_DIRECT_URL}'`);
    expect(helper).toContain(`?? '${backendTest.env?.KOMTRU_TEST_POOLED_URL}'`);
  });

  it('gives service containers to the backend alone', () => {
    for (const app of APPS.filter((name) => name !== 'backend-api')) {
      expect(workflows.get(app)!.jobs.test?.services).toBeUndefined();
      expect(workflows.get(app)!.jobs.test?.env).toBeUndefined();
    }
  });
});

/**
 * T-022. A replay from empty is what the backend's own Vitest globalSetup already does on every
 * infra run; this job is the rest — journal and snapshot drift, a migration edited after it was
 * applied, a statement that is safe only on an empty table, and the apply forward from main's
 * schema, which is the only check that sees the database a deploy will actually meet.
 */
describe('backend-api migration-safety job', () => {
  const backend = workflows.get('backend-api')!;
  const job = backend.jobs['migration-safety']!;
  const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));

  it('runs beside the test suite rather than behind it', () => {
    expect(asArray(job.needs).sort()).toEqual(['lint', 'typecheck']);
  });

  it('gates the deploy', () => {
    expect(asArray(backend.jobs.deploy?.needs)).toContain('migration-safety');
    // The placeholder comment that stood in for this job is gone.
    expect(workflowText.get('backend-api')).not.toContain('T-022 adds');
  });

  it('checks out the whole history, without which there is no main to apply forward from', () => {
    expect(Number(checkout?.with?.['fetch-depth'])).toBe(0);
  });

  it('installs through the shared composite action', () => {
    expect(job.steps[0]?.uses).toMatch(/^actions\/checkout@v\d+$/);
    expect(job.steps.some((step) => step.uses === './.github/actions/setup')).toBe(true);
  });

  it('runs the tool', () => {
    expect(job.steps.map((step) => step.run ?? '').join('\n')).toContain('pnpm migration:safety');
  });

  it('gives it one Postgres, the same image and credentials docker-compose uses', () => {
    expect(job.services?.postgres?.image).toBe(compose.services.postgres?.image);
    expect(job.services?.postgres?.env).toEqual(compose.services.postgres?.environment);
    expect(job.services?.postgres?.ports).toEqual([`${LOCAL_PORTS.postgres}:5432`]);
    expect(job.services?.postgres?.options).toContain('--health-cmd');
  });

  it('needs no PgBouncer and no Redis, because migrations only ever run direct', () => {
    expect(Object.keys(job.services ?? {})).toEqual(['postgres']);
  });

  it('points the tool at that Postgres, as the test job is pointed at it', () => {
    expect(job.env?.KOMTRU_TEST_DIRECT_URL).toBe(backendTest.env?.KOMTRU_TEST_DIRECT_URL);
  });

  it('belongs to the backend alone', () => {
    for (const app of APPS.filter((name) => name !== 'backend-api'))
      expect(workflows.get(app)!.jobs['migration-safety']).toBeUndefined();
  });
});
