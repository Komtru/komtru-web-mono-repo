// Fails if any secret-bearing path could be committed.
// docs/specs/backend-apis.env holds live credentials for AWS, Cloudinary, Paystack and others.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MUST_BE_IGNORED = [
  'docs/specs/backend-apis.env',
  '.env',
  '.env.local',
  'apps/backend-api/.env',
  'apps/web-app-ui/.env.local',
  'apps/operations-app/.env.production',
  'apps/logistics-ops/.env',
  'apps/park-agent-app/.env',
];

export const MUST_BE_TRACKABLE = ['apps/backend-api/.env.example', 'apps/web-app-ui/.env.example'];

/** `.env`, `.env.<anything>` and `<name>.env`, except `.env.example`. */
const isSecretPath = (p) => {
  const base = path.posix.basename(p);
  if (base === '.env.example') return false;
  return base === '.env' || base.startsWith('.env.') || base.endsWith('.env');
};

const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });

/**
 * Returns the paths git would NOT ignore. Without `--no-index`, `git check-ignore` treats a tracked or
 * staged path as not ignored, so a `git add -f` of a secret is reported here.
 */
export function findUnignored(paths, cwd = repoRoot) {
  return paths.filter((p) => git(['check-ignore', '-q', p], cwd).status !== 0);
}

/** Secret-looking paths that are already tracked or staged — i.e. would be (or were) committed. */
export function findCommittableSecrets(cwd = repoRoot) {
  const tracked = git(['ls-files', '--cached', '-z'], cwd).stdout.split('\0').filter(Boolean);
  return [...new Set(tracked)].filter(isSecretPath).sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const leaks = [...findUnignored(MUST_BE_IGNORED), ...findCommittableSecrets()];
  if (leaks.length > 0) {
    process.stderr.write(
      `These secret paths could be committed (unignore or untrack them with \`git rm --cached\`):\n${[
        ...new Set(leaks),
      ]
        .map((p) => `  ${p}`)
        .join('\n')}\n`,
    );
    process.exit(1);
  }
}
