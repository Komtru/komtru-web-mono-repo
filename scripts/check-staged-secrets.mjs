// Pre-commit guard: blocks a commit whose staged files contain a secret.
//   KNOWN_VALUE  a value copied from docs/specs/backend-apis.env (the old backend's live credentials)
//   PATTERN      a key-shaped string (Paystack secret keys, PEM private keys, AWS access keys)
// Reports name the file and the kind of finding only. They never print the secret.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultSecretsSource, parseEnv } from './env/populate-backend-env.mjs';

const PATTERNS = [
  /sk_(live|test)_[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

const MIN_SECRET_LENGTH = 12;
const isPlainUrl = (v) => /^[a-z][a-z0-9+.-]*:\/\/[^@\s]*$/i.test(v);
const isUrlList = (v) =>
  v.includes(',') && v.split(',').every((part) => isPlainUrl(part.trim()) || part.trim().startsWith('/'));
const isNonSecret = (v) =>
  /^(true|false)$/i.test(v) ||
  /^\d+$/.test(v) ||
  /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ||
  isPlainUrl(v) ||
  isUrlList(v);

/** Values worth scanning for: long, and not obviously public. A URL's embedded password is added too. */
export function loadSecretValues(envPath) {
  if (!existsSync(envPath)) return [];
  const values = new Set();
  for (const value of Object.values(parseEnv(readFileSync(envPath, 'utf8')))) {
    if (value.length < MIN_SECRET_LENGTH || isNonSecret(value)) continue;
    values.add(value);
    try {
      const password = decodeURIComponent(new URL(value).password);
      if (password.length >= 8) values.add(password);
    } catch {
      // not a URL
    }
  }
  return [...values];
}

const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** @returns {{ file: string, kind: 'KNOWN_VALUE' | 'PATTERN' }[]} */
export function findSecretsInStaged({ cwd, secretValues }) {
  const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], cwd)
    .stdout.split('\0')
    .filter(Boolean);
  const findings = [];
  for (const file of staged) {
    const content = git(['show', `:${file}`], cwd).stdout;
    if (secretValues.some((secret) => content.includes(secret))) findings.push({ file, kind: 'KNOWN_VALUE' });
    else if (PATTERNS.some((re) => re.test(content))) findings.push({ file, kind: 'PATTERN' });
  }
  return findings;
}

export function formatFindings(findings) {
  const why = {
    KNOWN_VALUE: 'contains a value from docs/specs/backend-apis.env',
    PATTERN: 'contains a key-shaped secret',
  };
  return findings.map((f) => `  ${f.file}: ${why[f.kind]}`).join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const findings = findSecretsInStaged({
    cwd: repoRoot,
    secretValues: loadSecretValues(defaultSecretsSource(repoRoot)),
  });
  if (findings.length > 0) {
    process.stderr.write(`Commit blocked: staged files contain secrets.\n${formatFindings(findings)}\n`);
    process.stderr.write('Remove the secret, reference it through an env variable, then stage again.\n');
    process.exit(1);
  }
}
