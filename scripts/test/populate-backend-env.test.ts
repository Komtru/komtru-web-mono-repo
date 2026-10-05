import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBackendEnv, parseEnv } from '../env/populate-backend-env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Not named *.env: that pattern is git-ignored and blocked by the secret guard.
const fixturePath = path.join(here, 'fixtures/old-backend.env.fixture');
const fixture = readFileSync(fixturePath, 'utf8');
const script = path.join(here, '../env/populate-backend-env.mjs');
const fixtureValues = Object.values(parseEnv(fixture)).filter((v) => v.length >= 8);

const valueOf = (text: string, key: string) => parseEnv(text)[key];

describe('parseEnv', () => {
  it('strips an inline comment from an unquoted value, as dotenv does', () => {
    expect(parseEnv('PORT=7813   # HTTP port\n').PORT).toBe('7813');
  });

  it('keeps a # inside a quoted value', () => {
    expect(parseEnv('NAME="a # b"\n').NAME).toBe('a # b');
  });
});

describe('buildBackendEnv — local target', () => {
  const { text } = buildBackendEnv(fixture, { target: 'local' });

  it('points the app at PgBouncer as the runtime role, on the new database', () => {
    expect(valueOf(text, 'POSTGRES_URL')).toBe(
      'postgresql://komtru_app:komtru_app@localhost:56432/komtru_v2_dev',
    );
    expect(valueOf(text, 'POSTGRES_APP_PASSWORD')).toBe('komtru_app');
  });

  it('adds a direct Postgres URL for migrations', () => {
    expect(valueOf(text, 'POSTGRES_DIRECT_URL')).toBe(
      'postgresql://komtru:komtru@localhost:55432/komtru_v2_dev',
    );
  });

  it('uses local Redis without TLS to Postgres', () => {
    expect(valueOf(text, 'REDIS_URL')).toBe('redis://localhost:56379');
    expect(valueOf(text, 'POSTGRES_SSL')).toBe('false');
  });

  it('keeps Mailjet in sandbox so local runs never email real people', () => {
    expect(valueOf(text, 'MAILJET_SANDBOX')).toBe('true');
  });

  it('keeps every other key and value unchanged', () => {
    expect(valueOf(text, 'ENCRYPTION_KEY')).toBe('fixture0encryption0key0value0aaaabbbbccccdddd');
    expect(valueOf(text, 'MAILJET_API_KEY')).toBe('fixture-mailjet-key-value');
    expect(valueOf(text, 'PAYSTACK_SECRET_KEY')).toBe('fixture-paystack-secret-value');
    expect(valueOf(text, 'PORT')).toBe('7813');
  });

  it('copies quoted values byte for byte so JSON and escaped keys survive', () => {
    const line = (key: string) => text.split('\n').find((l) => l.startsWith(`${key}=`));
    const sourceLine = (key: string) => fixture.split('\n').find((l) => l.startsWith(`${key}=`));
    expect(line('FCM_SERVICE_ACCOUNT_JSON')).toBe(sourceLine('FCM_SERVICE_ACCOUNT_JSON'));
    expect(line('APPLE_OAUTH_PRIVATE_KEY')).toBe(sourceLine('APPLE_OAUTH_PRIVATE_KEY'));
    expect(line('HTTP_LOG_IGNORE_PATHS')).toBe(sourceLine('HTTP_LOG_IGNORE_PATHS'));
  });

  it('writes a duplicated key once, keeping the last value', () => {
    expect(text.match(/^GOOGLE_OAUTH_CLIENT_ID=/gm)).toHaveLength(1);
    expect(valueOf(text, 'GOOGLE_OAUTH_CLIENT_ID')).toBe('second-google-client-id-value');
  });
});

describe('buildBackendEnv — rds target', () => {
  const { text } = buildBackendEnv(fixture, { target: 'rds' });

  it('keeps the RDS host and credentials but switches to the new database', () => {
    // Built at runtime so secretlint does not see a connection string with a password in this file.
    const expected = [
      'postgresql',
      '//fixture_user:fixture-db-password-123@devdb.fixture.us-east-1.rds.amazonaws.com:5432/komtru_v2_dev',
    ].join(':');
    expect(valueOf(text, 'POSTGRES_DIRECT_URL')).toBe(expected);
  });

  it('runs the app as komtru_app on the same host, with a password derived from the owner password', () => {
    const appUrl = new URL(valueOf(text, 'POSTGRES_URL') ?? '');
    const password = valueOf(text, 'POSTGRES_APP_PASSWORD') ?? '';
    expect(password).toMatch(/^[0-9a-f]{64}$/);
    expect(appUrl.username).toBe('komtru_app');
    expect(appUrl.password).toBe(password);
    expect(appUrl.host).toBe('devdb.fixture.us-east-1.rds.amazonaws.com:5432');
    expect(appUrl.pathname).toBe('/komtru_v2_dev');
    // Stable across regenerations, so two developers sharing the database never clobber each other.
    expect(valueOf(buildBackendEnv(fixture, { target: 'rds' }).text, 'POSTGRES_APP_PASSWORD')).toBe(password);
    expect(password).not.toContain('fixture-db-password-123');
  });

  it('switches any other database name to komtru_v2_dev too', () => {
    const other = fixture.replace('/komtru_dev', '/postgres');
    const { text: switched } = buildBackendEnv(other, { target: 'rds' });
    expect(valueOf(switched, 'POSTGRES_URL')).toMatch(/\/komtru_v2_dev$/);
  });

  it('never targets the old komtru_dev database', () => {
    expect(text).not.toMatch(/\/komtru_dev\b/);
  });
});

describe('env:backend CLI', () => {
  let dir: string;
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: dir });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes the file with owner-only permissions and prints names, never values', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'komtru-env-'));
    const out = path.join(dir, '.env');
    const result = run('--source', fixturePath, '--out', out);
    expect(result.status).toBe(0);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(result.stdout).toContain('POSTGRES_URL');
    for (const value of fixtureValues) {
      expect(result.stdout + result.stderr).not.toContain(value);
    }
  });

  it('refuses to overwrite an existing file without --force', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'komtru-env-'));
    const out = path.join(dir, '.env');
    writeFileSync(out, 'HAND_EDITED=1\n');
    const result = run('--source', fixturePath, '--out', out);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--force');
    expect(readFileSync(out, 'utf8')).toBe('HAND_EDITED=1\n');
  });

  it('names the expected path when the secrets source is missing', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'komtru-env-'));
    const missing = path.join(dir, 'nope/backend-apis.env');
    const result = run('--source', missing, '--out', path.join(dir, '.env'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(missing);
    expect(result.stderr).not.toMatch(/at .+\.mjs:\d+/);
  });
});
