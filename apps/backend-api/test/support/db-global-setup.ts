// Vitest globalSetup: builds the migrated template database once per run. Each worker then clones it
// (test/support/db.ts), which is far faster than migrating per worker.
import pg from 'pg';
import { runMigrations } from '../../src/db/migrator.js';
import { TEMPLATE_DATABASE, TEST_APP_PASSWORD, directUrl, infraEnabled } from './db-urls.js';

export default async function setup(): Promise<void> {
  if (!infraEnabled) return;
  const admin = new pg.Client({ connectionString: directUrl('postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEMPLATE_DATABASE}`);
  } finally {
    await admin.end();
  }
  await runMigrations({ directUrl: directUrl(TEMPLATE_DATABASE), appPassword: TEST_APP_PASSWORD });
}
