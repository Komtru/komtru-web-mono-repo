// The runtime role. Migrations run as the owner; the API and worker run as komtru_app, which can read
// and write module tables but cannot change the schema, and can only append to append-only tables.
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

/** Lets komtru_app log in with this password. The password never appears in logs or errors. */
export async function setRuntimePassword(client: pg.ClientBase, password: string): Promise<void> {
  await client.query(
    `ALTER ROLE ${ident(client, RUNTIME_ROLE)} LOGIN PASSWORD ${client.escapeLiteral(password)}`,
  );
}

export class RuntimeRoleError extends Error {
  constructor(readonly user: string) {
    super(
      `POSTGRES_URL connects as "${user}", which is a superuser or owns the schema. ` +
        `The app must run as ${RUNTIME_ROLE}; see docs/runbooks/local-dev.md.`,
    );
    this.name = 'RuntimeRoleError';
  }
}

/** Refuses to run the app as a superuser or as the role that owns the migrated schema. */
export async function assertNotOwner(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ user: string; privileged: boolean }>(
    `SELECT current_user AS user,
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
            OR EXISTS (SELECT 1 FROM pg_namespace
                        WHERE nspname = $1 AND pg_get_userbyid(nspowner) = current_user) AS privileged`,
    [MIGRATIONS_SCHEMA],
  );
  const row = rows[0];
  if (!row || row.privileged) throw new RuntimeRoleError(row?.user ?? 'unknown');
}
