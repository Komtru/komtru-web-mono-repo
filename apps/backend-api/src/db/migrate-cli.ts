// `pnpm db:migrate`: apply migrations to the database named by POSTGRES_DIRECT_URL.
import { ConfigError, loadConfig } from '../config/env.js';
import { createLogger } from '../platform/logger.js';
import { runMigrations } from './migrator.js';
import { runSeeds } from './seed-runner.js';

try {
  const config = loadConfig(process.env);
  if (!config.postgres.directUrl) throw new ConfigError(['POSTGRES_DIRECT_URL'], []);
  await runMigrations({
    directUrl: config.postgres.directUrl,
    ...(config.postgres.appPassword ? { appPassword: config.postgres.appPassword } : {}),
    ssl: config.postgres.ssl,
    caCertPath: config.postgres.caCertPath,
    logger: createLogger(config, { process: 'migrate' }),
  });
  // Reference data, not schema: the RBAC catalogue and the reserved namespace are reconciled from
  // code on every deploy rather than frozen into a migration (see modules/*/…/seed.ts).
  await runSeeds({
    directUrl: config.postgres.directUrl,
    ssl: config.postgres.ssl,
    caCertPath: config.postgres.caCertPath,
  });
} catch (error) {
  process.stderr.write(`${error instanceof ConfigError ? error.message : 'Migration failed.'}\n`);
  if (!(error instanceof ConfigError) && error instanceof Error) process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
}
