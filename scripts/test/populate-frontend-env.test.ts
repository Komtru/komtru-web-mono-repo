import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { FRONTEND_APPS, buildFrontendEnv, generateSessionSecret } from '../env/populate-frontend-env.mjs';
import { parseEnv } from '../env/populate-backend-env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const script = path.join(here, '../env/populate-frontend-env.mjs');
const exampleOf = (app: string) => readFileSync(path.join(repoRoot, `apps/${app}/.env.example`), 'utf8');

/**
 * Read out of app-kit's source rather than imported: this suite runs from the repository root,
 * which does not depend on app-kit. Reading it still fails here if the requirement ever moves,
 * which is the point — a secret this script generates has to satisfy the middleware that rejects it.
 */
const MIN_SECRET_LENGTH = Number(
  /MIN_SECRET_LENGTH = (\d+)/.exec(
    readFileSync(path.join(repoRoot, 'packages/app-kit/src/session.ts'), 'utf8'),
  )?.[1],
);

describe('the length middleware requires', () => {
  it('was found in app-kit, so the expectations below mean something', () => {
    expect(MIN_SECRET_LENGTH).toBeGreaterThanOrEqual(32);
  });
});

describe('generateSessionSecret', () => {
  it('is long enough for the sealer that middleware refuses to start without', () => {
    expect(generateSessionSecret().length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
  });

  it('is a fresh value each time, so no secret is ever shared by being hard-coded', () => {
    expect(generateSessionSecret()).not.toBe(generateSessionSecret());
  });

  it('needs no quoting in a .env file', () => {
    expect(generateSessionSecret()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe.each(FRONTEND_APPS)('buildFrontendEnv — %s', (app) => {
  const secret = 'y'.repeat(MIN_SECRET_LENGTH);
  const text = buildFrontendEnv(exampleOf(app), { secret });

  // The example cannot carry a secret — scripts/test/env-examples.test.ts forbids one — so copying
  // it leaves KOMTRU_SESSION_SECRET empty, and middleware throws on the first request of every
  // page. Filling it is the whole reason this script exists.
  it('fills the session secret the example has to leave blank', () => {
    expect(parseEnv(text).KOMTRU_SESSION_SECRET).toBe(secret);
  });

  it('keeps every other line of the example verbatim, comments included', () => {
    const dropSecret = (value: string) =>
      value.split('\n').filter((line) => !line.startsWith('KOMTRU_SESSION_SECRET='));
    expect(dropSecret(text)).toEqual(dropSecret(exampleOf(app)));
  });

  it('leaves the URLs pointing where the example documents', () => {
    const values = parseEnv(text);
    expect(values.NEXT_PUBLIC_KOMTRU_API_URL).toBe('http://localhost:7813/v1');
    expect(values.NEXT_PUBLIC_KOMTRU_APP_URL).toMatch(/^http:\/\/localhost:300\d$/);
  });
});

describe('env:apps CLI', () => {
  let dir: string;

  const seed = (apps: readonly string[]) => {
    dir = mkdtempSync(path.join(tmpdir(), 'komtru-fe-env-'));
    for (const app of apps) {
      mkdirSync(path.join(dir, 'apps', app), { recursive: true });
      writeFileSync(path.join(dir, 'apps', app, '.env.example'), exampleOf(app));
    }
    return dir;
  };

  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, '--root', dir, ...args], { encoding: 'utf8' });

  const localOf = (app: string) => path.join(dir, 'apps', app, '.env.local');

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a usable .env.local for every frontend, owner-only', () => {
    seed(FRONTEND_APPS);
    const result = run();
    expect(result.status).toBe(0);
    for (const app of FRONTEND_APPS) {
      expect(existsSync(localOf(app))).toBe(true);
      expect(statSync(localOf(app)).mode & 0o777).toBe(0o600);
      const secret = parseEnv(readFileSync(localOf(app), 'utf8')).KOMTRU_SESSION_SECRET ?? '';
      expect(secret.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    }
  });

  /**
   * On localhost every app shares the host `localhost` and cookies ignore the port, so all four
   * read each other's `komtru_session`. One secret makes that cookie open and fail the scope check
   * it would fail in production; separate secrets would make it unreadable garbage instead.
   */
  it('gives every app the same secret, so a cross-app cookie fails on scope, not on noise', () => {
    seed(FRONTEND_APPS);
    expect(run().status).toBe(0);
    const secrets = FRONTEND_APPS.map(
      (app) => parseEnv(readFileSync(localOf(app), 'utf8')).KOMTRU_SESSION_SECRET,
    );
    expect(new Set(secrets).size).toBe(1);
  });

  it('prints the file paths and variable names, never the secret', () => {
    seed(FRONTEND_APPS);
    const result = run();
    const secret = parseEnv(readFileSync(localOf('web-app-ui'), 'utf8')).KOMTRU_SESSION_SECRET ?? '';
    expect(result.stdout).toContain('KOMTRU_SESSION_SECRET');
    expect(result.stdout).toContain('apps/web-app-ui/.env.local');
    expect(result.stdout + result.stderr).not.toContain(secret);
  });

  it('leaves a hand-edited file alone unless asked to replace it', () => {
    seed(FRONTEND_APPS);
    writeFileSync(localOf('web-app-ui'), 'KOMTRU_SESSION_SECRET=hand-edited-value-kept-as-is-ok\n');
    const result = run();
    expect(result.status).toBe(0);
    expect(readFileSync(localOf('web-app-ui'), 'utf8')).toContain('hand-edited-value-kept-as-is-ok');
    expect(result.stdout).toMatch(/kept/i);
    // The apps that had nothing still get one: a partial setup is the common case.
    expect(existsSync(localOf('operations-app'))).toBe(true);
  });

  it('replaces an existing file only with --force', () => {
    seed(FRONTEND_APPS);
    writeFileSync(localOf('web-app-ui'), 'KOMTRU_SESSION_SECRET=hand-edited-value-kept-as-is-ok\n');
    expect(run('--force').status).toBe(0);
    expect(readFileSync(localOf('web-app-ui'), 'utf8')).not.toContain('hand-edited-value-kept-as-is-ok');
  });

  it('names the app whose example is missing instead of failing obscurely', () => {
    seed(FRONTEND_APPS.filter((app) => app !== 'park-agent-app'));
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('park-agent-app/.env.example');
    expect(result.stderr).not.toMatch(/at .+\.mjs:\d+/);
  });
});
