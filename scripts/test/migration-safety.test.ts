// The static half of tools/migration-safety: the journal, the snapshot chain and the lock. None of
// it needs a database, so it runs in every `pnpm test:repo`. The fixtures under
// fixtures/migration-safety/ are minimal drizzle folders carrying exactly one defect each.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { baseMigrations, runChecks } from '../../tools/migration-safety/check.mjs';
import {
  LOCK_PATH,
  MIGRATIONS_DIR,
  checkJournal,
  checkLock,
  loadMigrations,
} from '../../tools/migration-safety/migrations.mjs';
import { readWaiverFile } from '../../tools/migration-safety/lint.mjs';
import type { Finding } from '../../tools/migration-safety/migrations.mjs';

const fixture = (name: string) => resolve(import.meta.dirname, 'fixtures/migration-safety', name);
const rules = (findings: Finding[]) => findings.map((finding) => finding.rule);
/**
 * What `counts.waived` means, computed the way check.mjs computes it: one per (migration, rule)
 * pair in waivers.json. Derived rather than a literal for the same reason the migration list is -
 * every ticket that waives a statement would otherwise have to edit two assertions here, and the
 * claim that matters is that the number the checker reports is the number of waivers on disk.
 */
const waivedStatements = () =>
  Object.values(readWaiverFile()).reduce(
    (total, waivers) => total + Object.keys(waivers as Record<string, string>).length,
    0,
  );

const temporaries: string[] = [];
/** A throwaway copy of the repository's own drizzle folder, for the "someone edited it" cases. */
const copyOfMigrations = (): string => {
  const dir = mkdtempSync(resolve(tmpdir(), 'komtru-migration-safety-'));
  temporaries.push(dir);
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  return dir;
};
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

describe('loadMigrations', () => {
  it('reads every migration the journal names, in journal order, with its snapshot', () => {
    const migrations = loadMigrations();
    // Derived from the journal, not a literal list: every ticket that adds a migration would
    // otherwise have to edit this test, and the assertion that matters is that the folder and the
    // journal agree — not what today's tags happen to be.
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    const expected = [...journal.entries].sort((a, b) => a.idx - b.idx).map((entry) => entry.tag);
    expect(migrations.map((migration) => migration.tag)).toEqual(expected);
    expect(migrations.every((migration) => /^[0-9a-f]{64}$/.test(migration.sha256))).toBe(true);

    // One migration pinned by name rather than index, as a spot check that the SQL and the snapshot
    // travel together.
    const sameUserFks = migrations.find((migration) => migration.tag === '0007_identity_same_user_fks');
    expect(sameUserFks?.sql).toContain('users_primary_email_fk');
    expect(Object.keys(sameUserFks?.snapshot.tables ?? {})).toContain('identity.users');
  });

  it('throws when the journal names a migration that is not on disk', () => {
    expect(() => loadMigrations(fixture('missing-sql'))).toThrow(/0000_first\.sql/);
  });
});

describe('checkJournal', () => {
  it('passes on the repository drizzle folder', () => {
    expect(checkJournal()).toEqual([]);
  });

  it('reports journal-complete when the journal names a migration with no sql file', () => {
    expect(rules(checkJournal(fixture('missing-sql')))).toContain('journal-complete');
  });

  it('reports journal-complete for a sql file no journal entry names', () => {
    const findings = checkJournal(fixture('orphan-sql'));
    expect(rules(findings)).toContain('journal-complete');
    expect(findings.map((finding) => finding.message).join('\n')).toContain('0001_second.sql');
  });

  it('reports snapshot-chain when a snapshot prevId does not match the previous snapshot id', () => {
    expect(rules(checkJournal(fixture('broken-chain')))).toEqual(['snapshot-chain']);
  });

  it('reports journal-order when a later entry carries an older timestamp', () => {
    const findings = checkJournal(fixture('out-of-order'));
    expect(rules(findings)).toEqual(['journal-order']);
    // The message has to name both migrations: the remedy is to regenerate the later one.
    expect(findings[0]?.message).toContain('0001_second');
    expect(findings[0]?.message).toContain('0000_first');
  });
});

describe('checkLock', () => {
  it('passes on the committed lock', () => {
    expect(checkLock()).toEqual([]);
  });

  it('lists every migration in the folder', () => {
    const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as { migrations: { tag: string }[] };
    expect(lock.migrations.map((entry) => entry.tag)).toEqual(
      loadMigrations().map((migration) => migration.tag),
    );
  });

  it('reports migration-edited when a locked migration file changes', () => {
    const dir = copyOfMigrations();
    const file = resolve(dir, '0002_platform_events.sql');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n-- edited after it was applied\n`);
    const findings = checkLock(dir);
    expect(rules(findings)).toEqual(['migration-edited']);
    expect(findings[0]?.tag).toBe('0002_platform_events');
  });

  it('reports migration-edited when a locked migration timestamp changes', () => {
    const dir = copyOfMigrations();
    const journalPath = resolve(dir, 'meta/_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { when: number; tag: string }[];
    };
    journal.entries[3]!.when += 1;
    writeFileSync(journalPath, JSON.stringify(journal, null, 2));
    expect(rules(checkLock(dir))).toEqual(['migration-edited']);
  });

  it('reports migration-unlocked for a migration the lock does not list', () => {
    const dir = copyOfMigrations();
    const journalPath = resolve(dir, 'meta/_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
    };
    const last = journal.entries.at(-1)!;
    // Numbered off the journal rather than a literal, so adding a real migration to the repo does
    // not collide with this fixture's tag.
    const nextIdx = last.idx + 1;
    const tag = `${String(nextIdx).padStart(4, '0')}_new`;
    journal.entries.push({ ...last, idx: nextIdx, when: last.when + 1, tag });
    writeFileSync(journalPath, JSON.stringify(journal, null, 2));
    writeFileSync(resolve(dir, `${tag}.sql`), 'CREATE SCHEMA "later";\n');
    cpSync(
      resolve(dir, `meta/${String(last.idx).padStart(4, '0')}_snapshot.json`),
      resolve(dir, `meta/${String(nextIdx).padStart(4, '0')}_snapshot.json`),
    );
    const findings = checkLock(dir);
    expect(rules(findings)).toEqual(['migration-unlocked']);
    expect(findings[0]?.message).toContain('--update-lock');
  });

  it('reports migration-removed when a locked migration is gone from the journal', () => {
    const dir = copyOfMigrations();
    const journalPath = resolve(dir, 'meta/_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    journal.entries.pop();
    writeFileSync(journalPath, JSON.stringify(journal, null, 2));
    expect(rules(checkLock(dir))).toContain('migration-removed');
  });
});

describe('baseMigrations', () => {
  const repoRoot = resolve(import.meta.dirname, '../..');
  const status = () => execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });

  it('reads the baseline folder out of git without touching the working tree', () => {
    const before = status();
    const base = baseMigrations('HEAD');
    if (base.ref === null) throw new Error(base.reason);
    expect(base.ref).toBe('HEAD');
    // Compared against HEAD's own journal, not the working tree's: while a migration is being
    // added (or renumbered during a merge) the two legitimately differ, and the claim this test
    // makes is that `baseMigrations` reads from git — not that nothing is in flight.
    const headJournal = JSON.parse(
      execFileSync('git', ['show', 'HEAD:apps/backend-api/drizzle/meta/_journal.json'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }),
    ) as { entries: { idx: number; tag: string }[] };
    expect(base.migrations.map((migration) => migration.tag)).toEqual(
      [...headJournal.entries].sort((a, b) => a.idx - b.idx).map((entry) => entry.tag),
    );
    expect(status()).toBe(before);
  });

  it('gives a reason instead of throwing when the named ref is not in the repository', () => {
    const base = baseMigrations('no-such-ref-for-t-022');
    expect(base.ref).toBeNull();
    expect(base.explicit).toBe(true);
    expect(base.reason).toContain('no-such-ref-for-t-022');
  });

  it('gives a reason when the baseline predates the migration folder', () => {
    // A branch cut before T-021 has a merge base with no apps/backend-api/drizzle at all.
    //
    // This needs real history: 453ddc5 is the commit that added the folder and the test wants its
    // parent. A shallow clone does not have it, and the bare git error that produces says nothing
    // about why — so say it here. CI checks this repository out with fetch-depth: 0 for this test.
    let beforeDrizzle: string;
    try {
      beforeDrizzle = execFileSync('git', ['rev-parse', '453ddc5^'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }).trim();
    } catch (error) {
      throw new Error(
        'cannot resolve 453ddc5^ — this checkout is shallow. Run `git fetch --unshallow`, or ' +
          'give the workflow `fetch-depth: 0`.',
        { cause: error },
      );
    }
    const base = baseMigrations(beforeDrizzle);
    expect(base.ref).toBeNull();
    expect(base.reason).toContain('apps/backend-api/drizzle');
  });
});

describe('the command line', () => {
  const cli = fileURLToPath(new URL('../../tools/migration-safety/cli.mjs', import.meta.url));
  const run = (...args: string[]) => {
    try {
      return { status: 0, out: execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }) };
    } catch (error) {
      const failure = error as { status: number; stdout: string; stderr: string };
      return { status: failure.status, out: `${failure.stdout}${failure.stderr}` };
    }
  };

  it('passes the static checks and names each one it ran', () => {
    const { status, out } = run('--static');
    expect(out).toContain('ran journal, lock, lint');
    // A check that did nothing must never read as a check that passed, so the waived count is here,
    // and it has to be a number someone would notice going to zero.
    expect(waivedStatements()).toBeGreaterThan(0);
    expect(out).toContain(`${waivedStatements()} waived statement(s)`);
    expect(status).toBe(0);
  });

  it('refuses a --base-ref with no value instead of quietly using the default', () => {
    const { status, out } = run('--static', '--base-ref');
    expect(out).toContain('--base-ref needs a value');
    expect(status).toBe(2);
  });

  it('documents every flag it accepts', () => {
    const { out } = run('--help');
    for (const flag of ['--static', '--base-ref', '--update-lock', '--update-invariants'])
      expect(out).toContain(flag);
  });
});

describe('runChecks', () => {
  it('passes every check that needs no database', async () => {
    const { findings, counts, ran } = await runChecks({ staticOnly: true });
    expect(findings).toEqual([]);
    // Both counts come from their own source of truth for the same reason the list above does.
    expect(counts).toMatchObject({
      migrations: loadMigrations().length,
      waived: waivedStatements(),
      errors: 0,
      warnings: 0,
    });
    expect(ran).toEqual(['journal', 'lock', 'lint']);
  });

  it('stops at the journal rather than throwing on a folder it cannot read', async () => {
    // Everything after the journal check loads the migrations, which throws on a missing file; the
    // journal check is the one that can report it.
    const { findings, ran } = await runChecks({ staticOnly: true, dir: fixture('missing-sql') });
    expect(findings.map((item) => item.rule)).toEqual(['journal-complete']);
    expect(ran).toEqual(['journal']);
  });
});
