// `pnpm db:seed`: reconcile the reference data into the database named by POSTGRES_DIRECT_URL,
// without applying migrations. `pnpm db:migrate` does both; this exists for a catalogue change that
// needed no schema change.
import { ConfigError, loadConfig } from '../config/env.js';
import { runSeeds } from './seed-runner.js';

try {
  const config = loadConfig(process.env);
  if (!config.postgres.directUrl) throw new ConfigError(['POSTGRES_DIRECT_URL'], []);
  await runSeeds({ directUrl: config.postgres.directUrl, ssl: config.postgres.ssl });
} catch (error) {
  process.stderr.write(`${error instanceof ConfigError ? error.message : 'Seeding failed.'}\n`);
  if (!(error instanceof ConfigError) && error instanceof Error) process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
}
