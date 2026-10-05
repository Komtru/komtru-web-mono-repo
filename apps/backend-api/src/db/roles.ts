// The runtime role. Migrations run as the owner; the API and worker run as komtru_app, which can read
// and write module tables but cannot change the schema, and can only append to append-only tables.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import type pg from 'pg';

export const RUNTIME_ROLE = 'komtru_app';
/** Every append-only table carries a trigger with this name (see helpers/appendOnly.ts). */
export const APPEND_ONLY_TRIGGER = 'komtru_append_only';
/** Drizzle's migration journal lives here; the migrations' owner owns it. */
export const MIGRATIONS_SCHEMA = 'drizzle';

const SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_toast', 'public', MIGRATIONS_SCHEMA];

const ident = (client: pg.ClientBase, name: string) => client.escapeIdentifier(name);

/**
 * Grants komtru_app what it needs on every module schema. Idempotent, and run after every migration,
 * so a schema added by a later migration needs no hand-written grant. Append-only tables are
 * recognised by their trigger and only ever get INSERT and SELECT, however often this runs.
 */
export async function grantRuntimeAccess(client: pg.ClientBase): Promise<void> {
  const role = ident(client, RUNTIME_ROLE);
  // Database ACLs live outside the database's own catalogs, so CREATE DATABASE ... TEMPLATE and
  // dump/restore drop them: re-apply on every run rather than once in a migration. No temporary
  // tables: they are session state, which transaction pooling cannot keep.
  const { rows: databases } = await client.query<{ name: string }>('SELECT current_database() AS name');
  const database = ident(client, databases[0]?.name ?? '');
  await client.query(`REVOKE CREATE, TEMPORARY ON DATABASE ${database} FROM PUBLIC`);
  await client.query(`REVOKE CREATE, TEMPORARY ON DATABASE ${database} FROM ${role}`);
  await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
  const { rows: schemas } = await client.query<{ name: string }>(
    `SELECT nspname AS name FROM pg_namespace
      WHERE nspname <> ALL($1::text[]) AND nspname NOT LIKE 'pg\\_%'`,
    [SYSTEM_SCHEMAS],
  );
  for (const { name } of schemas) {
    const schema = ident(client, name);
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} TO ${role}`);
  }

  const { rows: tables } = await client.query<{ schema: string; name: string; appendOnly: boolean }>(
    `SELECT n.nspname AS schema, c.relname AS name,
            EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = $2) AS "appendOnly"
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND n.nspname <> ALL($1::text[]) AND n.nspname NOT LIKE 'pg\\_%'`,
    [SYSTEM_SCHEMAS, APPEND_ONLY_TRIGGER],
  );
  for (const table of tables) {
    const qualified = `${ident(client, table.schema)}.${ident(client, table.name)}`;
    if (table.appendOnly) {
      await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON ${qualified} FROM ${role}`);
      await client.query(`GRANT INSERT, SELECT ON ${qualified} TO ${role}`);
    } else {
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${qualified} TO ${role}`);
    }
  }
}

/**
 * Checks the runtime role ended up locked down. The REVOKEs above silently do nothing when the
 * migrating role does not own the object (possible on RDS), so check the result, not the intent.
 */
export async function verifyLockdown(client: pg.ClientBase): Promise<void> {
  const { rows } = await client.query<{ problem: string }>(
    `SELECT problem FROM (VALUES
        ('komtru_app can CREATE in schema public', has_schema_privilege($1, 'public', 'CREATE')),
        ('komtru_app can CREATE on the database', has_database_privilege($1, current_database(), 'CREATE')),
        ('komtru_app can create TEMPORARY tables', has_database_privilege($1, current_database(), 'TEMPORARY')),
        ('komtru_app is a superuser or can create roles or databases',
          (SELECT rolsuper OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname = $1))
      ) AS checks(problem, failed)
      WHERE failed`,
    [RUNTIME_ROLE],
  );
  if (rows.length) {
    throw new Error(
      `Runtime role lockdown failed: ${rows.map((r) => r.problem).join('; ')}. ` +
        'The migrating role must own the database and schema public (see docs/runbooks/local-dev.md).',
    );
  }
}

/**
 * The SCRAM-SHA-256 verifier Postgres stores for a password (RFC 5802/7677, Postgres's encoding).
 * Sending this instead of the plaintext keeps the password out of the server log, which records
 * the statement text on errors and under log_statement=ddl.
 */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16), iterations = 4096): string {
  const salted = pbkdf2Sync(password.normalize('NFKC'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest('base64');
  const serverKey = createHmac('sha256', salted).update('Server Key').digest('base64');
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey}:${serverKey}`;
}

/** Lets komtru_app log in with this password; only its SCRAM verifier reaches the server. */
export async function setRuntimePassword(client: pg.ClientBase, password: string): Promise<void> {
  await client.query(
    `ALTER ROLE ${ident(client, RUNTIME_ROLE)} LOGIN PASSWORD ${client.escapeLiteral(scramVerifier(password))}`,
  );
}

export class RuntimeRoleError extends Error {
  constructor(readonly user: string) {
    super(
      `POSTGRES_URL connects as "${user}", which can change the schema or create roles. ` +
        `The app must run as ${RUNTIME_ROLE}; see docs/runbooks/local-dev.md.`,
    );
    this.name = 'RuntimeRoleError';
  }
}

/**
 * Refuses to run the app as anything that can change the schema or mint roles: a superuser, the RDS
 * master (rds_superuser, which is not rolsuper), a role with CREATEROLE/CREATEDB or CREATE on the
 * database, or a role that owns (or is a member of the owner of) any non-system schema. Works
 * before the first migration too, so an owner URL is caught however early it is configured.
 */
export async function assertNotOwner(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ user: string; privileged: boolean }>(
    `SELECT current_user AS user,
            r.rolsuper OR r.rolcreaterole OR r.rolcreatedb
            OR has_database_privilege(current_database(), 'CREATE')
            OR EXISTS (SELECT 1 FROM pg_roles s
                        WHERE s.rolname = 'rds_superuser' AND pg_has_role(current_user, s.oid, 'MEMBER'))
            OR EXISTS (SELECT 1 FROM pg_namespace n
                        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                          AND n.nspname NOT LIKE 'pg\\_%'
                          AND pg_has_role(current_user, n.nspowner, 'MEMBER')) AS privileged
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  const row = rows[0];
  if (!row || row.privileged) throw new RuntimeRoleError(row?.user ?? 'unknown');
}
