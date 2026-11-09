// Applies migrations as the owner over the direct URL (never through PgBouncer), then refreshes the
// runtime role's grants and password.
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { postgresSslOptions } from '../platform/postgres-ssl.js';
import type { Logger } from '../platform/logger.js';
import { MIGRATIONS_SCHEMA, grantRuntimeAccess, setRuntimePassword, verifyLockdown } from './roles.js';

/** apps/backend-api/drizzle, from both src/db (tsx) and dist/db (built). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export interface MigrateOptions {
  directUrl: string;
  appPassword?: string;
  ssl?: boolean;
  /** Path to a PEM CA bundle, from POSTGRES_CA_CERT. */
  caCertPath?: string | undefined;
  logger?: Pick<Logger, 'info'>;
}

export async function runMigrations({
  directUrl,
  appPassword,
  ssl = false,
  caCertPath,
  logger,
}: MigrateOptions): Promise<void> {
  const client = new pg.Client({
    connectionString: directUrl,
    ssl: postgresSslOptions({ ssl, caCertPath }),
  });
  await client.connect();
  try {
    await migrate(drizzle(client), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: MIGRATIONS_SCHEMA,
    });
    await grantRuntimeAccess(client);
    await verifyLockdown(client);
    if (appPassword) await setRuntimePassword(client, appPassword);
    logger?.info({ runtimePasswordSet: Boolean(appPassword) }, 'migrations applied');
  } finally {
    await client.end();
  }
}
