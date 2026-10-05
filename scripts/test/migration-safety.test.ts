// The static half of tools/migration-safety: the journal, the snapshot chain and the lock. None of
// it needs a database, so it runs in every `pnpm test:repo`. The fixtures under
// fixtures/migration-safety/ are minimal drizzle folders carrying exactly one defect each.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  LOCK_PATH,
  MIGRATIONS_DIR,
  checkJournal,
  checkLock,
  loadMigrations,
} from '../../tools/migration-safety/migrations.mjs';
import type { Finding } from '../../tools/migration-safety/migrations.mjs';

const fixture = (name: string) => resolve(import.meta.dirname, 'fixtures/migration-safety', name);
const rules = (findings: Finding[]) => findings.map((finding) => finding.rule);

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
    expect(migrations.map((migration) => migration.tag)).toEqual([
      '0000_platform_schema',
      '0001_platform_roles',
      '0002_platform_events',
      '0003_idempotency_keys',
      '0004_identity_citext',
      '0005_identity_enums',
      '0006_identity_core',
      '0007_identity_same_user_fks',
      '0008_identity_rbac',
      '0009_identity_dual_approval',
      '0010_identity_sessions',
      '0011_identity_audit_log',
      '0012_identity_audit_append_only',
      '0013_identity_four_eyes',
      '0014_identity_dual_approval_hardening',
      '0015_identity_desc_indexes',
    ]);
    expect(migrations.every((migration) => /^[0-9a-f]{64}$/.test(migration.sha256))).toBe(true);
    expect(migrations[7]?.tag).toBe('0007_identity_same_user_fks');
    expect(migrations[7]?.sql).toContain('users_primary_email_fk');
    expect(Object.keys(migrations[7]?.snapshot.tables ?? {})).toContain('identity.users');
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
    journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1, tag: '0016_new' });
    writeFileSync(journalPath, JSON.stringify(journal, null, 2));
    writeFileSync(resolve(dir, '0016_new.sql'), 'CREATE SCHEMA "later";\n');
    cpSync(resolve(dir, 'meta/0015_snapshot.json'), resolve(dir, 'meta/0016_snapshot.json'));
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
