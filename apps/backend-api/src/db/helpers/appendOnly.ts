// SQL for an audit table that can only grow. Put the output in a custom migration
// (`pnpm db:generate --custom`) right after the migration that creates the table:
//   UPDATE and DELETE raise KT001 for everyone, the owner included (platform.reject_mutation);
//   komtru_app gets INSERT and SELECT only, and grantRuntimeAccess() keeps it that way.
import { APPEND_ONLY_TRIGGER, RUNTIME_ROLE } from '../roles.js';

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const BREAKPOINT = '\n--> statement-breakpoint\n';

/** `table` is `schema.table`, lower-case, in a module schema (never `public`). */
export function appendOnly(table: string): string {
  const parts = table.split('.');
  const [schema, name] = parts;
  if (parts.length !== 2 || !schema || !name || !IDENTIFIER.test(schema) || !IDENTIFIER.test(name)) {
    throw new TypeError(`appendOnly(): expected "schema.table" in lower case, got "${table}"`);
  }
  if (schema === 'public') throw new TypeError('appendOnly(): module tables never live in public');

  const qualified = `"${schema}"."${name}"`;
  return [
    `CREATE TRIGGER ${APPEND_ONLY_TRIGGER} BEFORE UPDATE OR DELETE ON ${qualified} FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();`,
    `REVOKE ALL ON ${qualified} FROM ${RUNTIME_ROLE};`,
    `GRANT INSERT, SELECT ON ${qualified} TO ${RUNTIME_ROLE};`,
  ].join(BREAKPOINT);
}
