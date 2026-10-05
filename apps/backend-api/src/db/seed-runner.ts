// Applies every registered module's reference data (platform/module.ts's `seed` hook) over the
// direct URL, as the owner — the same connection style as the migrator, and never through PgBouncer.
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { modules } from '../modules/index.js';
import { runModuleSeeds } from '../platform/module.js';

export interface SeedOptions {
  directUrl: string;
  ssl?: boolean;
}

export async function runSeeds({ directUrl, ssl = false }: SeedOptions): Promise<void> {
  const client = new pg.Client({
    connectionString: directUrl,
    ssl: ssl ? { rejectUnauthorized: true } : false,
  });
  await client.connect();
  try {
    await runModuleSeeds(modules, drizzle(client));
  } finally {
    await client.end();
  }
}
