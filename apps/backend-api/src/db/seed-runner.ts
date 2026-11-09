// Applies every registered module's reference data (platform/module.ts's `seed` hook) over the
// direct URL, as the owner — the same connection style as the migrator, and never through PgBouncer.
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { postgresSslOptions } from '../platform/postgres-ssl.js';
import { moduleSeeds } from '../modules/index.js';
import { runModuleSeeds } from '../platform/module.js';

export interface SeedOptions {
  directUrl: string;
  ssl?: boolean;
  /** Path to a PEM CA bundle, from POSTGRES_CA_CERT. */
  caCertPath?: string | undefined;
}

export async function runSeeds({ directUrl, ssl = false, caCertPath }: SeedOptions): Promise<void> {
  const client = new pg.Client({
    connectionString: directUrl,
    ssl: postgresSslOptions({ ssl, caCertPath }),
  });
  await client.connect();
  try {
    await runModuleSeeds(moduleSeeds, drizzle(client));
  } finally {
    await client.end();
  }
}
