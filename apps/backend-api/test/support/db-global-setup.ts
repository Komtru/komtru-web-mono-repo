// Vitest globalSetup: builds the migrated template database once per run. Each worker then clones it
// (test/support/db.ts), which is far faster than migrating per worker.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../src/db/migrator.js';
import {
  TEST_APP_PASSWORD,
  directUrl,
  infraEnabled,
  releaseRunKeyspace,
  templateDatabaseName,
} from './db-urls.js';

export default async function setup(): Promise<() => Promise<void>> {
  // Postgres gets a brand-new template every run, below. Redis had no equivalent: its namespace was
  // keyed on the worker alone, so every run inherited the last one's queues — BullMQ keeps a failed
  // job for 30 days and silently ignores re-adding its id, which makes a job that cannot run again
  // also a job that cannot be replaced. Minting the id here, before any worker forks, is what makes
  // a run's Redis as fresh as its database.
  process.env.KOMTRU_TEST_RUN_ID ??= `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  if (!infraEnabled) return () => Promise.resolve();

  const template = templateDatabaseName();
  const admin = new pg.Client({ connectionString: directUrl('postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${template} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${template}`);
  } finally {
    await admin.end();
  }
  await runMigrations({ directUrl: directUrl(template), appPassword: TEST_APP_PASSWORD });

  // A fresh namespace per run is only half of it: without this, every run leaves its whole keyspace
  // behind, and a day's work buries the instance in dead queues. Scoped to the id minted above, so
  // it can only ever remove what this run created — never a concurrent run's, and never the
  // application's own `komtru:` keys.
  return async () => {
    await releaseRunKeyspace();
  };
}
