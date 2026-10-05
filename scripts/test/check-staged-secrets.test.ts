import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findSecretsInStaged, formatFindings, loadSecretValues } from '../check-staged-secrets.mjs';

// Assembled at runtime so this file never contains a literal key-shaped string itself.
const FAKE_PAYSTACK_KEY = ['sk', 'test', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4'].join('_');
const FAKE_PEM_HEADER = ['-----BEGIN', 'RSA PRIVATE', 'KEY-----'].join(' ');
const KNOWN_SECRET = 'known-secret-value-from-the-env-file-123';

describe('findSecretsInStaged', () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  const stage = (file: string, content: string) => {
    writeFileSync(path.join(repo, file), content);
    git('add', file);
  };

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'komtru-staged-'));
    git('init', '-q');
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('reports a staged file containing a value from the credentials file', () => {
    stage('notes.md', `config: ${KNOWN_SECRET}\n`);
    expect(findSecretsInStaged({ cwd: repo, secretValues: [KNOWN_SECRET] })).toEqual([
      { file: 'notes.md', kind: 'KNOWN_VALUE' },
    ]);
  });

  it('reports a Paystack-shaped secret key by pattern', () => {
    stage('client.ts', `const key = '${FAKE_PAYSTACK_KEY}';\n`);
    expect(findSecretsInStaged({ cwd: repo, secretValues: [] })).toEqual([
      { file: 'client.ts', kind: 'PATTERN' },
    ]);
  });

  it('reports a PEM private key by pattern', () => {
    stage('key.txt', `${FAKE_PEM_HEADER}\nabc\n`);
    expect(findSecretsInStaged({ cwd: repo, secretValues: [] })).toEqual([
      { file: 'key.txt', kind: 'PATTERN' },
    ]);
  });

  it('finds nothing in clean files, including an empty .env.example', () => {
    stage('clean.ts', 'export const x = 1;\n');
    stage('.env.example', 'PAYSTACK_SECRET_KEY=\n');
    expect(findSecretsInStaged({ cwd: repo, secretValues: [KNOWN_SECRET] })).toEqual([]);
  });

  it('never includes the secret in the printed report', () => {
    stage('notes.md', `config: ${KNOWN_SECRET} and ${FAKE_PAYSTACK_KEY}\n`);
    const report = formatFindings(findSecretsInStaged({ cwd: repo, secretValues: [KNOWN_SECRET] }));
    expect(report).toContain('notes.md');
    expect(report).not.toContain(KNOWN_SECRET);
    expect(report).not.toContain(FAKE_PAYSTACK_KEY);
  });
});

describe('loadSecretValues', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps long secret-like values and drops booleans, numbers, emails and credential-free URLs', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'komtru-values-'));
    const file = path.join(dir, 'source');
    // Built at runtime so secretlint does not see a connection string with a password in this file.
    const dbUrl = ['postgresql', '//user:db-password-value-xyz@host:5432/db'].join(':');
    writeFileSync(
      file,
      [
        `API_SECRET=${KNOWN_SECRET}`,
        'FLAG=true',
        'TTL=600000000000',
        'FROM=noreply@komtru.example',
        'ORIGINS=http://localhost:3001,http://localhost:3002',
        'ISSUER=https://api.komtru.com',
        `DB=${dbUrl}`,
        'SHORT=abc',
      ].join('\n'),
    );
    const values = loadSecretValues(file);
    expect(values).toContain(KNOWN_SECRET);
    expect(values).toContain(dbUrl);
    expect(values).toContain('db-password-value-xyz');
    expect(values).toHaveLength(3);
  });

  it('loads an RDS-style connection string and its password, not mistaking it for an email', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'komtru-values-'));
    const file = path.join(dir, 'source');
    const rdsUrl = [
      'postgresql',
      '//app_user:Rds-Pass-1234@devdb.abc123.us-east-1.rds.amazonaws.com:5432/komtru_dev',
    ].join(':');
    writeFileSync(file, `POSTGRES_URL=${rdsUrl}\nFROM=noreply@komtru.example\n`);
    const values = loadSecretValues(file);
    expect(values).toContain(rdsUrl);
    expect(values).toContain('Rds-Pass-1234');
    expect(values).not.toContain('noreply@komtru.example');
  });

  it('returns nothing when the credentials file is absent', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'komtru-values-'));
    expect(loadSecretValues(path.join(dir, 'missing'))).toEqual([]);
  });
});
