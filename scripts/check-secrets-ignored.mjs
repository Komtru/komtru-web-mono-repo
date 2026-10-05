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

/** Returns the paths git would NOT ignore. `git check-ignore` exits 0 when a path is ignored. */
export function findUnignored(paths) {
  return paths.filter((p) => {
    const result = spawnSync('git', ['check-ignore', '--no-index', '-q', p], { cwd: repoRoot });
    return result.status !== 0;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const leaks = findUnignored(MUST_BE_IGNORED);
  if (leaks.length > 0) {
    process.stderr.write(
      `These secret paths are not git-ignored:\n${leaks.map((p) => `  ${p}`).join('\n')}\n`,
    );
    process.exit(1);
  }
}
