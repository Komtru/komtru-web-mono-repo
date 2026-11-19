// Writes apps/backend-api/.env from the old backend's live .env (docs/specs/backend-apis.env).
//
// Design §3.4: keep every value and the old variable names, except the database and this
// monorepo's own local topology (see LOCAL_TOPOLOGY). The old URL points at `komtru_dev`, which
// the old backend already migrated; the new build must never touch it.
//   --target local (default)  Point Postgres and Redis at the local Docker stack (docker-compose.yml).
//   --target rds              Keep the RDS host, switch the database to komtru_v2_dev; migrations use the
//                             owner credentials, the app runs as komtru_app with a derived password.
//
// SECURITY: this script prints variable NAMES only, never values, including on error paths.
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_APP_ROLE, LOCAL_INFRA } from './local-infra.mjs';

export const NEW_DATABASE = 'komtru_v2_dev';
/** The least-privilege role the API and worker run as (the migrator creates it; design T-021). */
export const RUNTIME_ROLE = 'komtru_app';

/**
 * Where this monorepo's processes live on a developer's machine. These are facts about THIS build,
 * not about the old backend, so they are set rather than copied: the source is the old backend's
 * env, and its answers describe the old stack — the API on 3000, origins on 3000/7820/5501, and two
 * base URLs left empty. Copied verbatim they mis-wire every local run, and silently: the API starts
 * on a port no frontend calls, then refuses the origins they do call from.
 *
 * Ports match apps/*\/.env.example and the dev-server table in the README. The same answers hold
 * for `--target rds`, where only the database moves — the frontends are still on this laptop.
 */
/**
 * Where the Amazon RDS CA bundle lives on a developer's machine. Named in the .env rather than left
 * to NODE_EXTRA_CA_CERTS so a verified RDS connection does not depend on which shell started the
 * process; the runbook has the one-line download. Only the rds target needs it — the Docker stack
 * speaks plain TCP.
 */
export const RDS_CA_BUNDLE = path.join(homedir(), '.komtru', 'certs', 'rds-global-bundle.pem');

export const LOCAL_TOPOLOGY = Object.freeze({
  apiPort: '7813',
  consumerApp: 'http://localhost:3001',
  staffApp: 'http://localhost:3002',
  /**
   * Every frontend origin, including the two whose apps are still placeholders. 3005 is the
   * marketing site, which calls exactly one route — POST /v1/waitlist — and is blocked by the
   * browser without it.
   */
  origins: [3001, 3002, 3003, 3004, 3005].map((port) => `http://localhost:${port}`).join(','),
});

/** KEY -> the right-hand side exactly as written in the source (quotes, escapes, comments kept). */
function parseEnvRaw(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/**
 * Parses KEY=VALUE lines the way dotenv reads them. Later duplicates win. Surrounding quotes are
 * removed; an unquoted value loses a trailing ` # comment`.
 */
export function parseEnv(text) {
  const out = {};
  for (const [key, raw] of Object.entries(parseEnvRaw(text))) {
    const quoted = raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw.at(-1) === raw[0];
    out[key] = quoted ? raw.slice(1, -1) : raw.replace(/\s+#.*$/, '');
  }
  return out;
}

// Always the new database, whatever the source named: any existing database on that server belongs
// to the old backend (`komtru_dev` today), and the new schema must never be migrated into it.
const switchDatabase = (url) => {
  const parsed = new URL(url);
  parsed.pathname = `/${NEW_DATABASE}`;
  return parsed.toString();
};

/**
 * The runtime role's password on a shared server, derived from the owner's password so every
 * developer regenerating their .env gets the same value and nobody resets it under someone else.
 * Whoever holds the owner password can derive it, which grants nothing they did not already have.
 */
const deriveRuntimePassword = (ownerPassword) =>
  createHmac('sha256', ownerPassword).update(`${RUNTIME_ROLE}@${NEW_DATABASE}`).digest('hex');

const asRuntimeRole = (ownerUrl, password) => {
  const url = new URL(ownerUrl);
  url.username = RUNTIME_ROLE;
  url.password = password;
  return url.toString();
};

/**
 * @param {string} sourceText contents of the old backend .env
 * @param {{ target: 'local' | 'rds' }} options
 * @returns {{ text: string, names: string[] }}
 */
export function buildBackendEnv(sourceText, { target }) {
  // Untouched keys are copied with their original right-hand side so quoted JSON and escaped keys
  // survive exactly; only keys this function sets are written fresh (their values need no quoting).
  const values = parseEnvRaw(sourceText);
  const parsed = parseEnv(sourceText);

  if (target === 'local') {
    values.POSTGRES_URL = LOCAL_INFRA.appPooledUrl;
    values.POSTGRES_DIRECT_URL = LOCAL_INFRA.directUrl;
    values.POSTGRES_APP_PASSWORD = LOCAL_APP_ROLE.password;
    values.POSTGRES_SSL = 'false';
    values.POSTGRES_CA_CERT = '';
  } else if (target === 'rds') {
    if (!parsed.POSTGRES_URL) throw new UsageError('The source has no POSTGRES_URL to switch.');
    const ownerUrl = switchDatabase(parsed.POSTGRES_URL);
    const appPassword = deriveRuntimePassword(decodeURIComponent(new URL(ownerUrl).password));
    values.POSTGRES_DIRECT_URL = ownerUrl;
    values.POSTGRES_URL = asRuntimeRole(ownerUrl, appPassword);
    values.POSTGRES_APP_PASSWORD = appPassword;
    values.POSTGRES_CA_CERT = RDS_CA_BUNDLE;
  } else {
    throw new UsageError(`Unknown --target "${target}". Use "local" or "rds".`);
  }

  // After the branch: `--target` chooses where the DATABASE lives, not whether this is a
  // developer's machine. Everything below is true of both targets, and leaving any of it to the
  // source means `--target rds` quietly inherits the old stack's answer.
  values.REDIS_URL = LOCAL_INFRA.redisUrl;
  // A local run must never email real people; Mailjet's sandbox validates without sending.
  values.MAILJET_SANDBOX = 'true';
  values.PORT = LOCAL_TOPOLOGY.apiPort;
  values.APP_WEB_BASE_URL = LOCAL_TOPOLOGY.consumerApp;
  values.APP_STAFF_WEB_BASE_URL = LOCAL_TOPOLOGY.staffApp;
  values.ALLOWED_ORIGINS = LOCAL_TOPOLOGY.origins;
  values.SOCKET_CORS_ORIGINS = LOCAL_TOPOLOGY.origins;
  // Both land on the consumer app: it owns sign-in, and a passkey is registered against its origin.
  values.OAUTH_REDIRECT_BASE_URL = LOCAL_TOPOLOGY.consumerApp;
  values.WEBAUTHN_ORIGINS = LOCAL_TOPOLOGY.consumerApp;
  values.WEBAUTHN_RP_ID = 'localhost';

  const names = Object.keys(values);
  const header = [
    '# Generated by `pnpm env:backend` from docs/specs/backend-apis.env. Never commit this file.',
    `# Target: ${target}. Database: ${NEW_DATABASE}.`,
  ];
  const text = [...header, ...names.map((k) => `${k}=${values[k]}`)].join('\n') + '\n';
  return { text, names };
}

class UsageError extends Error {}

/** The secrets file is git-ignored, so it only exists in the main checkout, not in worktrees. */
export function defaultSecretsSource(cwd = process.cwd()) {
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
  });
  const commonDir = result.status === 0 ? result.stdout.trim() : path.join(cwd, '.git');
  return path.join(path.dirname(commonDir), 'docs/specs/backend-apis.env');
}

function parseArgs(argv) {
  const args = { target: 'local', source: undefined, out: undefined, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--force') args.force = true;
    else if (flag === '--target' || flag === '--source' || flag === '--out') {
      const value = argv[i + 1];
      if (!value) throw new UsageError(`${flag} needs a value.`);
      args[flag.slice(2)] = value;
      i += 1;
    } else throw new UsageError(`Unknown option ${flag}.`);
  }
  return args;
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const args = parseArgs(process.argv.slice(2));
  const source = args.source ?? defaultSecretsSource(repoRoot);
  const out = args.out ?? path.join(repoRoot, 'apps/backend-api/.env');

  if (!existsSync(source)) {
    throw new UsageError(
      `Secrets source not found: ${source}\nCopy the old backend's .env there (it is git-ignored), or pass --source <path>.`,
    );
  }
  if (existsSync(out) && !args.force) {
    throw new UsageError(`${out} already exists. Re-run with --force to overwrite it.`);
  }

  const { text, names } = buildBackendEnv(readFileSync(source, 'utf8'), { target: args.target });
  writeFileSync(out, text, { mode: 0o600 });
  chmodSync(out, 0o600);
  process.stdout.write(`Wrote ${names.length} variables to ${out} (target: ${args.target}):\n`);
  process.stdout.write(`${names.join(', ')}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    // Messages are built only from paths and option names, never from env values.
    const message =
      error instanceof UsageError ? error.message : 'Unexpected failure while writing the env file.';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
