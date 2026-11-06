// `pnpm db:bootstrap-super-admins`: the break-glass path that creates the first SUPER_ADMIN(s).
//
//   pnpm db:bootstrap-super-admins --confirm-break-glass \
//     --user <uuid> [--user <uuid>] --granted-by <uuid> --approved-by <uuid> --reason "<why>"
//
// Runs over POSTGRES_DIRECT_URL as the owner. Refuses if any SUPER_ADMIN assignment exists, if a
// named user is missing, not ACTIVE or has no second factor, or if the four people are not distinct.
// See docs/superpowers/plans/2026-11-06-t-037-rbac-staff-admin.md for the procedure.
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { ConfigError, loadConfig } from '../src/config/env.js';
import { BootstrapRefused, bootstrapSuperAdmins } from '../src/modules/identity/index.js';

const args = process.argv.slice(2);
const values = (flag: string): string[] =>
  args.flatMap((arg, index) => (arg === flag && args[index + 1] ? [args[index + 1] as string] : []));
const one = (flag: string): string | undefined => values(flag)[0];

try {
  if (!args.includes('--confirm-break-glass')) {
    throw new BootstrapRefused('Pass --confirm-break-glass to say you mean it.');
  }
  const grantedBy = one('--granted-by');
  const approvedBy = one('--approved-by');
  const reason = one('--reason');
  if (!grantedBy || !approvedBy || !reason) {
    throw new BootstrapRefused('--granted-by, --approved-by and --reason are all required.');
  }

  const config = loadConfig(process.env);
  if (!config.postgres.directUrl) throw new ConfigError(['POSTGRES_DIRECT_URL'], []);
  const client = new pg.Client({
    connectionString: config.postgres.directUrl,
    ssl: config.postgres.ssl ? { rejectUnauthorized: true } : false,
  });
  await client.connect();
  try {
    const { assignmentIds } = await bootstrapSuperAdmins(drizzle(client), {
      userIds: values('--user'),
      grantedBy,
      approvedBy,
      reason,
    });
    process.stdout.write(`Created ${assignmentIds.length} SUPER_ADMIN assignment(s).\n`);
  } finally {
    await client.end();
  }
} catch (error) {
  const known = error instanceof BootstrapRefused || error instanceof ConfigError;
  process.stderr.write(`${known ? error.message : 'Bootstrap failed.'}\n`);
  if (!known && error instanceof Error) process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
}
