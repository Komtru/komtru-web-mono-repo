// One database per Vitest worker, cloned from the migrated template, emptied before every test.
// Tests reach it as the app does (komtru_app through PgBouncer) and, for setup, as the owner.
import { afterAll, beforeAll, beforeEach } from 'vitest';
import pg from 'pg';
import { createDb, type Db } from '../../src/db/index.js';
import { MIGRATIONS_SCHEMA, grantRuntimeAccess } from '../../src/db/roles.js';
import { TEMPLATE_DATABASE, directUrl, pooledUrl } from './db-urls.js';

export const workerDatabase = () => `komtru_test_${process.env.VITEST_POOL_ID ?? '1'}`;

/** Empties every table outside system schemas and the migration journal. */
export async function truncateAll(owner: pg.Pool): Promise<void> {
  const { rows } = await owner.query<{ qualified: string }>(
    `SELECT format('%I.%I', n.nspname, c.relname) AS qualified
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', $1)
        AND n.nspname NOT LIKE 'pg\\_%'`,
    [MIGRATIONS_SCHEMA],
  );
  if (rows.length)
    await owner.query(`TRUNCATE ${rows.map((r) => r.qualified).join(', ')} RESTART IDENTITY CASCADE`);
}

export interface TestDatabase {
  /** komtru_app through PgBouncer: what the API and worker get. */
  app(): pg.Pool;
  /** The owner, direct: for test setup the app is not allowed to do. */
  owner(): pg.Pool;
  db(): Db;
}

/** Call at the top of a test file (inside `describe.runIf(infraEnabled)`). */
export function useTestDatabase(): TestDatabase {
  let app: pg.Pool | undefined;
  let owner: pg.Pool | undefined;
  const need = <T>(value: T | undefined): T => {
    if (!value) throw new Error('useTestDatabase(): pools are only available inside tests');
    return value;
  };

  beforeAll(async () => {
    const name = workerDatabase();
    const admin = new pg.Client({ connectionString: directUrl('postgres') });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DATABASE}`);
    } finally {
      await admin.end();
    }
    app = new pg.Pool({ connectionString: pooledUrl(name), max: 4 });
    owner = new pg.Pool({ connectionString: directUrl(name), max: 2 });
    // A clone does not inherit the template's database-level ACLs; re-apply them as migrate does.
    const client = await owner.connect();
    try {
      await grantRuntimeAccess(client);
    } finally {
      client.release();
    }
  });

  beforeEach(async () => truncateAll(need(owner)));

  afterAll(async () => {
    await Promise.all([app?.end(), owner?.end()]);
  });

  return { app: () => need(app), owner: () => need(owner), db: () => createDb(need(app)) };
}
