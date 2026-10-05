import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildBackendEnv, defaultSecretsSource, parseEnv } from '../env/populate-backend-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const example = (app: string) => parseEnv(read(`apps/${app}/.env.example`));
const fixture = read('scripts/test/fixtures/old-backend.env.fixture');

const FRONTENDS = ['web-app-ui', 'operations-app', 'logistics-ops', 'park-agent-app'];
const LOOKS_SECRET = [/sk_(live|test)_/, /pk_(live|test)_/, /-----BEGIN/, /^[A-Za-z0-9+/=_-]{24,}$/];

describe('backend .env.example', () => {
  const keys = Object.keys(example('backend-api'));

  it('lists every key the env script writes, plus the new ones', () => {
    const { names } = buildBackendEnv(fixture, { target: 'local' });
    expect(names.filter((k) => !keys.includes(k))).toEqual([]);
    expect(keys).toEqual(expect.arrayContaining(['POSTGRES_DIRECT_URL', 'SENTRY_DSN']));
  });

  // Compares NAMES only. Skipped where the git-ignored credentials file is absent (CI, fresh clones).
  const source = defaultSecretsSource(root);
  it.runIf(existsSync(source))('covers every key in the real credentials file', () => {
    const realKeys = Object.keys(parseEnv(readFileSync(source, 'utf8')));
    expect(realKeys.filter((k) => !keys.includes(k))).toEqual([]);
  });
});

describe.each(['backend-api', ...FRONTENDS])('%s .env.example', (app) => {
  it('contains no value that looks like a real secret', () => {
    const suspicious = Object.entries(example(app))
      .filter(([, v]) => LOOKS_SECRET.some((re) => re.test(v)))
      .map(([k]) => k);
    expect(suspicious).toEqual([]);
  });
});

describe.each(FRONTENDS)('%s .env.example', (app) => {
  it('defines the API and app URLs', () => {
    expect(Object.keys(example(app))).toEqual(
      expect.arrayContaining(['NEXT_PUBLIC_KOMTRU_API_URL', 'NEXT_PUBLIC_KOMTRU_APP_URL']),
    );
  });
});
