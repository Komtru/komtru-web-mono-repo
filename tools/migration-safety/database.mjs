// Applying the migrations to a throwaway database, and reading back what they built.
//
// applyMigrations() is deliberately a re-implementation of drizzle's PgDialect.migrate rather than a
// call to it: the check has to reproduce how the real migrator chooses what to apply, including the
// part where a migration older than the last applied one is skipped without a word, and that
// behaviour is only observable from outside.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { finding } from './migrations.mjs';

export const INVARIANTS_PATH = resolve(fileURLToPath(new URL('.', import.meta.url)), 'invariants.json');

const DIRECT_BASE = process.env.KOMTRU_TEST_DIRECT_URL ?? 'postgresql://komtru:komtru@localhost:55432';
/** Every database this tool creates starts with this, so a shared Postgres can tell runs apart. */
const PREFIX = process.env.KOMTRU_MIGRATION_SAFETY_DB_PREFIX ?? 'komtru_migration_safety';

export const directUrl = (database) => `${DIRECT_BASE}/${database}`;

const SAFE_NAME = /^[a-z_][a-z0-9_]*$/;

const withAdmin = async (fn) => {
  const admin = new pg.Client({ connectionString: directUrl('postgres') });
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
};

/**
 * Creates `<prefix>_<label>`, hands over a connected client and drops the database again — including
 * when the body throws, because a leftover database on a shared Postgres breaks the next run.
 */
export async function scratchDatabase(label, run) {
  const name = `${PREFIX}_${label}`.replace(/-/g, '_');
  if (!SAFE_NAME.test(name)) throw new Error(`migration-safety: ${name} is not a usable database name`);
  const drop = (admin) => admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await withAdmin(async (admin) => {
    await drop(admin);
    await admin.query(`CREATE DATABASE ${name}`);
  });
  const client = new pg.Client({ connectionString: directUrl(name) });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
    await withAdmin(drop);
  }
}

const MIGRATIONS_TABLE = '"drizzle"."__drizzle_migrations"';

/**
 * What drizzle's migrator does: apply every journal entry newer than the newest `created_at` already
 * recorded, all of them inside one transaction. Returns what it applied and — the point of the
 * exercise — what it silently passed over because the timestamp said it was already history.
 */
export async function applyMigrations(client, migrations) {
  await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  const { rows } = await client.query(`SELECT hash, created_at FROM ${MIGRATIONS_TABLE}`);
  const appliedHashes = new Set(rows.map((row) => row.hash));
  const last = rows.length ? Math.max(...rows.map((row) => Number(row.created_at))) : null;

  const applied = [];
  const skipped = [];
  for (const migration of migrations) {
    if (last === null || last < migration.when) applied.push(migration);
    else if (!appliedHashes.has(migration.sha256)) skipped.push(migration);
  }

  let current = null;
  await client.query('BEGIN');
  try {
    for (const migration of applied) {
      current = migration;
      // drizzle sends each breakpoint-separated chunk as one query, so a chunk holding two
      // statements arrives as one multi-statement command. Mirror that, failures included.
      for (const chunk of migration.sql.split('--> statement-breakpoint')) await client.query(chunk);
      await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (hash, created_at) VALUES ($1, $2)`, [
        migration.sha256,
        migration.when,
      ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(`migration-safety: ${current?.tag} did not apply: ${error.message}`, { cause: error });
  }
  return { applied, skipped };
}

const USER_SCHEMAS = `nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'drizzle')
       AND nspname NOT LIKE 'pg\\_%'`;

/**
 * One sorted, comparable line per thing a migration can build. Two schemas that produce the same
 * fingerprint are the same schema; the forward check is nothing but a comparison of two of these.
 * The `drizzle` schema is excluded: its journal rows legitimately differ between two routes to the
 * same schema.
 */
export async function fingerprint(client) {
  const { rows } = await client.query(`
    WITH ns AS (SELECT oid, nspname FROM pg_namespace WHERE ${USER_SCHEMAS})
    SELECT format('schema %s', nspname) AS line FROM ns
    UNION ALL
    SELECT format('column %s.%s.%s #%s %s notnull=%s default=%s', n.nspname, c.relname, a.attname,
                  a.attnum, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                  coalesce(pg_get_expr(d.adbin, d.adrelid), '-'))
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN ns n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'v', 'm')
    UNION ALL
    SELECT format('constraint %s.%s.%s %s', n.nspname, c.relname, ct.conname, pg_get_constraintdef(ct.oid))
      FROM pg_constraint ct JOIN pg_class c ON c.oid = ct.conrelid JOIN ns n ON n.oid = c.relnamespace
    UNION ALL
    SELECT format('index %s', pg_get_indexdef(i.indexrelid))
      FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN ns n ON n.oid = c.relnamespace
    UNION ALL
    SELECT format('trigger %s', pg_get_triggerdef(t.oid))
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN ns n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal
    UNION ALL
    SELECT format('enum %s.%s %s', n.nspname, t.typname,
                  string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder))
      FROM pg_type t JOIN ns n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
     GROUP BY n.nspname, t.typname
    UNION ALL
    SELECT format('function %s.%s(%s) %s %s', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid), l.lanname, md5(p.prosrc))
      FROM pg_proc p JOIN ns n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
    UNION ALL
    SELECT format('sequence %s.%s', n.nspname, c.relname)
      FROM pg_class c JOIN ns n ON n.oid = c.relnamespace WHERE c.relkind = 'S'
    UNION ALL
    -- Privileges are part of the schema here: 0012 revokes UPDATE and DELETE on the audit log, and a
    -- migration that quietly granted them back would otherwise look like no change at all.
    SELECT format('acl %s.%s %s', n.nspname, c.relname,
                  (SELECT coalesce(string_agg(item::text, ' ' ORDER BY item::text), '-')
                     FROM unnest(coalesce(c.relacl, '{}'::aclitem[])) AS item))
      FROM pg_class c JOIN ns n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p')
  `);
  return rows.map((row) => row.line).sort();
}

const entries = (rows) =>
  rows
    .map(({ table, name, definition }) => ({ table, name, definition }))
    .sort((a, b) => `${a.table}.${a.name}`.localeCompare(`${b.table}.${b.name}`));

/**
 * The schema-level rules the application cannot be trusted to keep on its own: a partial unique
 * index, a check constraint, a trigger. Each one is a business rule in the database, so the list of
 * them is maintained by hand and compared on every build.
 */
export async function introspectInvariants(client) {
  const version = await client.query('SHOW server_version_num');
  const partialUniqueIndexes = await client.query(`
    SELECT format('%s.%s', n.nspname, c.relname) AS table, i.relname AS name,
           pg_get_indexdef(i.oid) AS definition
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class c ON c.oid = x.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE x.indisunique AND x.indpred IS NOT NULL AND ${USER_SCHEMAS}`);
  const checkConstraints = await client.query(`
    SELECT format('%s.%s', n.nspname, c.relname) AS table, ct.conname AS name,
           pg_get_constraintdef(ct.oid) AS definition
      FROM pg_constraint ct
      JOIN pg_class c ON c.oid = ct.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE ct.contype = 'c' AND ${USER_SCHEMAS}`);
  const triggers = await client.query(`
    SELECT format('%s.%s', n.nspname, c.relname) AS table, t.tgname AS name,
           pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal AND ${USER_SCHEMAS}`);
  return {
    postgresMajor: Math.floor(Number(version.rows[0].server_version_num) / 10000),
    partialUniqueIndexes: entries(partialUniqueIndexes.rows),
    checkConstraints: entries(checkConstraints.rows),
    triggers: entries(triggers.rows),
  };
}

const CATEGORIES = ['partialUniqueIndexes', 'checkConstraints', 'triggers'];

/** Compares what the migrations built against the list in invariants.json, both ways. */
export function checkInvariants(actual, expected) {
  if (actual.postgresMajor !== expected.postgresMajor)
    return [
      finding(
        'invariants',
        'postgres-major',
        `invariants.json was captured on Postgres ${expected.postgresMajor} and this server is ` +
          `${actual.postgresMajor}; definitions are printed differently across majors, so recapture ` +
          'the file on the major CI runs rather than comparing across them',
      ),
    ];
  const findings = [];
  for (const category of CATEGORIES) {
    const have = new Map((actual[category] ?? []).map((entry) => [`${entry.table}.${entry.name}`, entry]));
    const want = new Map((expected[category] ?? []).map((entry) => [`${entry.table}.${entry.name}`, entry]));
    for (const [key, entry] of have) {
      const wanted = want.get(key);
      if (!wanted)
        findings.push(
          finding(
            'invariants',
            'invariant-added',
            `${key} is in the database but not in invariants.json. Add it with ` +
              '`pnpm migration:safety --update-invariants` so the rule is written down: ' +
              entry.definition,
          ),
        );
      else if (wanted.definition !== entry.definition)
        findings.push(
          finding(
            'invariants',
            'invariant-changed',
            `${key} is no longer the rule on record.\n  recorded: ${wanted.definition}\n  found:    ${entry.definition}`,
          ),
        );
    }
    for (const key of want.keys())
      if (!have.has(key))
        findings.push(
          finding(
            'invariants',
            'invariant-removed',
            `${key} is in invariants.json but the migrations no longer create it`,
          ),
        );
  }
  return findings;
}

export const readInvariants = (path = INVARIANTS_PATH) => JSON.parse(readFileSync(path, 'utf8'));

export const writeInvariants = (invariants, path = INVARIANTS_PATH) =>
  writeFileSync(path, `${JSON.stringify(invariants, null, 2)}\n`);
