// The forward apply, and the orchestration the CLI runs.
//
// "Applies forward from main" is the check a replay from empty cannot be: it is the only one that
// sees the database the deploy will actually meet. It applies main's migrations, then this branch's
// on top exactly as the migrator would, and compares the result with a replay from empty. Two
// schemas that disagree mean this branch produces one database in CI and a different one in
// production — most often because a migration was edited after it was applied, or because its
// timestamp is older than main's last one and the migrator will never look at it again.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyMigrations,
  checkInvariants,
  fingerprint,
  introspectInvariants,
  readInvariants,
  scratchDatabase,
} from './database.mjs';
import { checkLint, readWaiverFile } from './lint.mjs';
import { checkJournal, checkLock, finding, loadMigrations } from './migrations.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const DRIZZLE_PATH = 'apps/backend-api/drizzle';
const MAX_DRIFT_LINES = 20;

// stderr is captured rather than inherited: several calls here are expected to fail (a ref that is
// not in a shallow clone, a baseline older than the migration folder) and say so in a finding.
const git = (...args) =>
  execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });

const resolveCommit = (ref) => {
  try {
    return git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`).trim() || null;
  } catch {
    return null;
  }
};

/**
 * The migration folder as it stands on the baseline, read straight out of git so the working tree is
 * never touched. The baseline is the merge base with `main`, not its tip: a branch that is simply
 * behind must not look like drift.
 */
export function baseMigrations(ref = process.env.KOMTRU_MIGRATION_BASE_REF) {
  const explicit = Boolean(ref);
  const candidates = explicit ? [ref] : ['origin/main', 'main'];
  const found = candidates.map((candidate) => [candidate, resolveCommit(candidate)]).find(([, sha]) => sha);
  if (!found)
    return {
      ref: null,
      explicit,
      reason: explicit
        ? `KOMTRU_MIGRATION_BASE_REF is "${ref}", which this repository does not have`
        : `neither origin/main nor main is in this clone, so there is no schema to apply forward from ` +
          '(a shallow checkout does this; the job needs fetch-depth: 0)',
    };
  const [name, sha] = found;
  let base = sha;
  try {
    base = git('merge-base', 'HEAD', sha).trim();
  } catch {
    // No common ancestor (an unrelated or very shallow history): compare against the ref itself.
  }
  let journal;
  try {
    journal = JSON.parse(git('show', `${base}:${DRIZZLE_PATH}/meta/_journal.json`));
  } catch {
    // The baseline predates the migration folder — true of any branch cut before T-021.
    return {
      ref: null,
      explicit,
      reason: `${name} (at ${base.slice(0, 8)}) has no ${DRIZZLE_PATH}, so there is no earlier schema to apply forward from`,
    };
  }
  const migrations = journal.entries.map((entry) => {
    const sql = git('show', `${base}:${DRIZZLE_PATH}/${entry.tag}.sql`);
    return {
      idx: entry.idx,
      tag: entry.tag,
      when: entry.when,
      sql,
      sha256: createHash('sha256').update(sql).digest('hex'),
      snapshot: {},
    };
  });
  return { ref: name, commit: base, migrations, explicit };
}

/** Builds the branch's schema twice — from empty, and on top of the baseline — and compares them. */
export async function compareForward(base, head) {
  const findings = [];
  base.forEach((migration, index) => {
    const mine = head[index];
    if (mine && mine.tag !== migration.tag)
      findings.push(
        finding(
          'forward',
          'forward-rewritten',
          `the baseline's migration ${index} is ${migration.tag} but this branch has ${mine.tag}: ` +
            'migration history can only be appended to',
          { tag: mine.tag },
        ),
      );
  });

  const fromEmpty = await scratchDatabase('head', async (client) => {
    await applyMigrations(client, head);
    return fingerprint(client);
  });
  const forward = await scratchDatabase('forward', async (client) => {
    await applyMigrations(client, base);
    const second = await applyMigrations(client, head);
    return { skipped: second.skipped, lines: await fingerprint(client) };
  });

  for (const migration of forward.skipped)
    findings.push(
      finding(
        'forward',
        'migration-skipped',
        `${migration.tag} was generated at ${migration.when}, which is not after the newest migration ` +
          'already applied from the baseline. The migrator compares only that timestamp, so this ' +
          'migration would never run on any database that already has the baseline. Regenerate it on ' +
          'top of main.',
        { tag: migration.tag },
      ),
    );

  const empty = new Set(fromEmpty);
  const applied = new Set(forward.lines);
  const differences = [
    ...fromEmpty.filter((line) => !applied.has(line)).map((line) => `only from empty: ${line}`),
    ...forward.lines.filter((line) => !empty.has(line)).map((line) => `only forward:    ${line}`),
  ];
  if (differences.length)
    findings.push(
      finding(
        'forward',
        'forward-drift',
        `applying these migrations on top of the baseline does not produce the same schema as ` +
          `applying them to an empty database (${differences.length} differences):\n  ` +
          differences.slice(0, MAX_DRIFT_LINES).join('\n  ') +
          (differences.length > MAX_DRIFT_LINES
            ? `\n  … and ${differences.length - MAX_DRIFT_LINES} more`
            : ''),
      ),
    );
  return findings;
}

export async function checkForward(ref) {
  const base = baseMigrations(ref);
  if (!base.ref)
    return [
      finding('forward', 'forward-skipped', base.reason, { severity: base.explicit ? 'error' : 'warning' }),
    ];
  // On a push to main the merge base is HEAD itself, so there is no earlier schema and the check
  // compares a branch with itself. Say so: a run that gates a deploy must not look the same whether
  // it compared two schemas or none.
  if (base.commit === resolveCommit('HEAD'))
    return [
      finding(
        'forward',
        'forward-noop',
        `the baseline (${base.ref}) is this commit, so nothing was applied forward. On a push to main ` +
          'that is expected; the pull request run is the one that compares the two schemas.',
        { severity: 'warning' },
      ),
    ];
  return compareForward(base.migrations, loadMigrations());
}

/** Everything, in the order a reader wants it: the cheap static checks first. */
export async function runChecks({ staticOnly = false, ref, dir } = {}) {
  const counts = { migrations: 0, waived: 0, replayed: 0, invariants: 0 };
  const ran = ['journal'];
  // Nothing downstream can read a folder the journal check has just called incomplete — loading it
  // would throw instead of reporting — so this is the one check that stops the run.
  const journal = checkJournal(dir);
  if (journal.length)
    return { findings: journal, counts: { ...counts, errors: journal.length, warnings: 0 }, ran };

  const migrations = loadMigrations(dir);
  counts.migrations = migrations.length;
  counts.waived = Object.values(readWaiverFile()).reduce(
    (total, waivers) => total + Object.keys(waivers).length,
    0,
  );
  const findings = [...checkLock(dir), ...checkLint(dir)];
  ran.push('lock', 'lint');

  if (!staticOnly) {
    const expected = readInvariants();
    const actual = await scratchDatabase('replay', async (client) => {
      const { applied } = await applyMigrations(client, migrations);
      counts.replayed = applied.length;
      return introspectInvariants(client);
    });
    counts.invariants =
      actual.partialUniqueIndexes.length + actual.checkConstraints.length + actual.triggers.length;
    findings.push(...checkInvariants(actual, expected));
    findings.push(...(await checkForward(ref)));
    ran.push('replay', 'invariants', 'forward');
  }

  counts.errors = findings.filter((item) => item.severity === 'error').length;
  counts.warnings = findings.filter((item) => item.severity === 'warning').length;
  return { findings, counts, ran };
}
