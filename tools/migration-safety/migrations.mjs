// Reading apps/backend-api/drizzle, and the two checks that need nothing but the folder itself.
//
// drizzle's migrator (PgDialect.migrate) decides what to apply by comparing each journal entry's
// `when` against the single most recent `created_at` already in drizzle.__drizzle_migrations. Two
// consequences this file exists to police:
//
//   - A migration whose `when` is older than one already applied is skipped silently, forever. That
//     is what a branch generated before another branch's migration merged looks like.
//   - The file hash is written to that table but never compared again, so editing an applied
//     migration leaves the database it already ran on permanently different from a fresh one.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export const MIGRATIONS_DIR = resolve(here, '../../apps/backend-api/drizzle');
export const LOCK_PATH = resolve(here, 'migrations.lock.json');

/** Every finding this tool produces. `error` fails the build; `warning` is reported and allowed. */
export const finding = (check, rule, message, extra = {}) => ({
  check,
  rule,
  message,
  severity: 'error',
  ...extra,
});

const readJournal = (dir) => JSON.parse(readFileSync(resolve(dir, 'meta/_journal.json'), 'utf8'));

const snapshotName = (idx) => `${String(idx).padStart(4, '0')}_snapshot.json`;

/**
 * Every migration the journal names, in journal order. Throws when a named file is missing, so the
 * callers that need the SQL can assume it is there; checkJournal() reports that case instead.
 */
export function loadMigrations(dir = MIGRATIONS_DIR) {
  const journal = readJournal(dir);
  return journal.entries.map((entry) => {
    const sqlPath = resolve(dir, `${entry.tag}.sql`);
    if (!existsSync(sqlPath)) throw new Error(`migration-safety: ${entry.tag}.sql is missing from ${dir}`);
    const snapshotPath = resolve(dir, 'meta', snapshotName(entry.idx));
    if (!existsSync(snapshotPath))
      throw new Error(`migration-safety: ${snapshotName(entry.idx)} is missing from ${dir}/meta`);
    const sql = readFileSync(sqlPath, 'utf8');
    return {
      idx: entry.idx,
      tag: entry.tag,
      when: entry.when,
      sql,
      // The same hash drizzle stores: sha256 of the whole file text.
      sha256: createHash('sha256').update(sql).digest('hex'),
      snapshot: JSON.parse(readFileSync(snapshotPath, 'utf8')),
    };
  });
}

/** The journal, the .sql files and the snapshot chain have to describe the same history. */
export function checkJournal(dir = MIGRATIONS_DIR) {
  const findings = [];
  const add = (rule, message, tag) => findings.push(finding('journal', rule, message, { tag }));
  const journal = readJournal(dir);
  const entries = journal.entries ?? [];

  const seenTags = new Set();
  const sqlFiles = new Set(readdirSync(dir).filter((name) => name.endsWith('.sql')));
  const snapshotFiles = new Set(
    readdirSync(resolve(dir, 'meta')).filter((name) => name.endsWith('_snapshot.json')),
  );

  entries.forEach((entry, position) => {
    const { tag, idx } = entry;
    if (idx !== position)
      add('journal-complete', `${tag} has idx ${idx} but sits at position ${position}`, tag);
    if (!/^\d{4}_/.test(tag) || Number(tag.slice(0, 4)) !== idx)
      add('journal-complete', `${tag} does not start with its own idx ${idx}`, tag);
    if (seenTags.has(tag)) add('journal-complete', `${tag} appears in the journal twice`, tag);
    seenTags.add(tag);

    if (!sqlFiles.delete(`${tag}.sql`))
      add('journal-complete', `the journal names ${tag} but ${tag}.sql is not in the folder`, tag);
    if (!snapshotFiles.delete(snapshotName(idx)))
      add('journal-complete', `${tag} has no meta/${snapshotName(idx)}`, tag);

    const previous = entries[position - 1];
    if (previous && entry.when <= previous.when)
      add(
        'journal-order',
        `${tag} was generated at ${entry.when}, which is not after ${previous.tag} at ${previous.when}: ` +
          'the migrator applies only entries newer than the last applied one, so this migration would ' +
          `be skipped forever on any database that already has ${previous.tag}. Regenerate it.`,
        tag,
      );
  });

  for (const orphan of [...sqlFiles, ...snapshotFiles])
    add('journal-complete', `${orphan} is in the folder but no journal entry names it`);

  // The snapshot chain is how drizzle-kit knows what the previous schema was; a break means a
  // migration was generated against a snapshot that is no longer the one before it.
  let previousId = '00000000-0000-0000-0000-000000000000';
  const seenIds = new Set();
  for (const entry of entries) {
    const path = resolve(dir, 'meta', snapshotName(entry.idx));
    if (!existsSync(path)) continue;
    const snapshot = JSON.parse(readFileSync(path, 'utf8'));
    if (snapshot.prevId !== previousId)
      add(
        'snapshot-chain',
        `meta/${snapshotName(entry.idx)} follows ${snapshot.prevId}, but the previous snapshot is ${previousId}`,
        entry.tag,
      );
    if (seenIds.has(snapshot.id))
      add('snapshot-chain', `meta/${snapshotName(entry.idx)} reuses snapshot id ${snapshot.id}`, entry.tag);
    if (snapshot.dialect !== journal.dialect || snapshot.version !== entry.version)
      add(
        'snapshot-chain',
        `meta/${snapshotName(entry.idx)} is ${snapshot.dialect}/v${snapshot.version}, ` +
          `the journal says ${journal.dialect}/v${entry.version}`,
        entry.tag,
      );
    seenIds.add(snapshot.id);
    previousId = snapshot.id;
  }
  return findings;
}

const readLock = (lockPath) => JSON.parse(readFileSync(lockPath, 'utf8'));

/**
 * The lock is the record of what has been applied. drizzle never re-checks an applied migration's
 * hash, so a change to one is invisible at runtime and has to be caught here, in review.
 */
export function checkLock(dir = MIGRATIONS_DIR, lockPath = LOCK_PATH) {
  const findings = [];
  const add = (rule, message, tag) => findings.push(finding('lock', rule, message, { tag }));
  const locked = new Map(readLock(lockPath).migrations.map((entry) => [entry.tag, entry]));
  for (const migration of loadMigrations(dir)) {
    const entry = locked.get(migration.tag);
    if (!entry) {
      add(
        'migration-unlocked',
        `${migration.tag} is not in migrations.lock.json; run \`pnpm migration:safety --update-lock\` ` +
          'and commit the result with the migration',
        migration.tag,
      );
      continue;
    }
    locked.delete(migration.tag);
    if (entry.sha256 !== migration.sha256)
      add(
        'migration-edited',
        `${migration.tag} no longer matches the lock. A migration that has already been applied is ` +
          'never re-read by the migrator, so this change reaches no existing database: fix it forward ' +
          'in a new migration instead.',
        migration.tag,
      );
    else if (entry.when !== migration.when)
      add(
        'migration-edited',
        `${migration.tag} was generated at ${entry.when} but the journal now says ${migration.when}; ` +
          'the migrator selects by that timestamp, so moving it changes what gets applied',
        migration.tag,
      );
  }
  for (const tag of locked.keys())
    add('migration-removed', `${tag} is in migrations.lock.json but no longer in the journal`, tag);
  return findings;
}

/** Rewrites the lock from the folder. Deliberate, reviewable, and part of the migration's commit. */
export function writeLock(dir = MIGRATIONS_DIR, lockPath = LOCK_PATH) {
  const migrations = loadMigrations(dir).map(({ tag, when, sha256 }) => ({ tag, when, sha256 }));
  writeFileSync(lockPath, `${JSON.stringify({ migrations }, null, 2)}\n`);
}
