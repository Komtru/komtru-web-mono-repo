// Writes apps/<frontend>/.env.local from each app's committed .env.example.
//
// Copying the example by hand is not enough. Every frontend's example ends with an empty
// `KOMTRU_SESSION_SECRET=`, because scripts/test/env-examples.test.ts forbids a committed file from
// holding anything secret-shaped — correctly. But `middleware.ts` calls `requireSessionSecret` at
// module scope, so an empty value throws on the first request and every page answers 500. A copied
// example therefore produces an app that boots and then serves nothing, which is the worst shape a
// failure can take: `pnpm dev` looks healthy in the terminal.
//
// This script closes that gap the way `pnpm env:backend` closes the backend's: generate what cannot
// be committed, keep everything the example documents.
//
// SECURITY: prints variable NAMES and file paths only, never values.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every app with a `.env.example`, including the two still waiting for their ticket. */
export const FRONTEND_APPS = Object.freeze([
  'web-app-ui',
  'operations-app',
  'logistics-ops',
  'park-agent-app',
]);

const SECRET_KEY = 'KOMTRU_SESSION_SECRET';

/**
 * 32 base64url characters — 192 bits, and no character a .env parser treats specially, so the value
 * never needs quoting. app-kit requires at least 32 (`MIN_SECRET_LENGTH`).
 */
export function generateSessionSecret() {
  return randomBytes(24).toString('base64url');
}

/**
 * @param {string} exampleText contents of the app's .env.example
 * @param {{ secret: string }} options
 * @returns {string}
 */
export function buildFrontendEnv(exampleText, { secret }) {
  let replaced = false;
  const lines = exampleText.split('\n').map((line) => {
    if (!line.startsWith(`${SECRET_KEY}=`)) return line;
    replaced = true;
    // The trailing `# 32+ chars, ...` comment goes with it: a generated value needs no instructions,
    // and this is the one line where a parser quirk around inline comments would be a silent 500.
    return `${SECRET_KEY}=${secret}`;
  });
  if (!replaced) throw new UsageError(`The example defines no ${SECRET_KEY} to fill.`);
  return lines.join('\n');
}

class UsageError extends Error {}

function parseArgs(argv) {
  const args = { root: undefined, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--force') args.force = true;
    else if (flag === '--root') {
      const value = argv[i + 1];
      if (!value) throw new UsageError(`${flag} needs a value.`);
      args.root = value;
      i += 1;
    } else throw new UsageError(`Unknown option ${flag}.`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = args.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

  const targets = FRONTEND_APPS.map((app) => ({
    app,
    example: path.join(repoRoot, 'apps', app, '.env.example'),
    out: path.join(repoRoot, 'apps', app, '.env.local'),
  }));

  // Checked before anything is written, so a missing example never leaves half the apps configured.
  const missing = targets.filter((t) => !existsSync(t.example));
  if (missing.length > 0) {
    throw new UsageError(
      `No .env.example for: ${missing.map((t) => `apps/${t.app}/.env.example`).join(', ')}`,
    );
  }

  // One secret for all four. On localhost they share a host and cookies ignore the port, so each app
  // receives the others' `komtru_session`. Sealed with the same key it opens, fails the scope check
  // and redirects — what production does, where the cookie simply never arrives. With separate keys
  // it would instead look like tampering, and a scope bug would hide behind the noise.
  const secret = generateSessionSecret();
  const written = [];
  const kept = [];

  for (const target of targets) {
    if (existsSync(target.out) && !args.force) {
      kept.push(target.app);
      continue;
    }
    writeFileSync(target.out, buildFrontendEnv(readFileSync(target.example, 'utf8'), { secret }), {
      mode: 0o600,
    });
    chmodSync(target.out, 0o600);
    written.push(target);
  }

  for (const target of written) {
    process.stdout.write(`Wrote apps/${target.app}/.env.local (${SECRET_KEY} generated)\n`);
  }
  if (kept.length > 0) {
    process.stdout.write(
      `Kept the existing .env.local in: ${kept.join(', ')}. Re-run with --force to replace them.\n`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    // Built from paths and option names only, never from a value read out of a file.
    const message =
      error instanceof UsageError ? error.message : 'Unexpected failure while writing the env files.';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
