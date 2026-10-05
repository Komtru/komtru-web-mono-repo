// The runtime role's privileges, against a migrated database. Skipped unless KOMTRU_INFRA_TESTS=1.
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { assertNotOwner, RuntimeRoleError } from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrator.js';
import { verifyLockdown } from '../../src/db/roles.js';
import { directUrl, infraEnabled, TEST_APP_PASSWORD } from '../support/db-urls.js';
import { useTestDatabase, workerDatabase } from '../support/db.js';

describe.runIf(infraEnabled)('runtime role', () => {
  const t = useTestDatabase();
  const migrateAgain = () =>
    runMigrations({ directUrl: directUrl(workerDatabase()), appPassword: TEST_APP_PASSWORD });

  it('runs the app as komtru_app', async () => {
    const { rows } = await t.app().query<{ user: string }>('SELECT current_user AS user');
    expect(rows[0]?.user).toBe('komtru_app');
  });

  it('leaves nothing in public', async () => {
    const { rows } = await t
      .owner()
      .query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    expect(rows).toEqual([]);
  });

  it('cannot create temporary tables, even in a database cloned from the template', async () => {
    await expect(t.app().query('CREATE TEMP TABLE scratch (id int)')).rejects.toThrow(/permission denied/);
  });

  it('fails a migrate run loudly when the lockdown did not take (e.g. an RDS owner lacking rights)', async () => {
    const client = await t.owner().connect();
    try {
      await client.query('GRANT CREATE ON SCHEMA public TO komtru_app');
      await expect(verifyLockdown(client)).rejects.toThrow(/komtru_app can CREATE in schema public/);
      await client.query('REVOKE CREATE ON SCHEMA public FROM komtru_app');
      await expect(verifyLockdown(client)).resolves.toBeUndefined();
    } finally {
      client.release();
    }
  });

  it('cannot change the schema', async () => {
    await expect(t.app().query('CREATE TABLE public.sneaky (id int)')).rejects.toThrow(/permission denied/);
    await expect(t.app().query('CREATE SCHEMA sneaky')).rejects.toThrow(/permission denied/);
    await expect(t.app().query('CREATE TABLE platform.sneaky (id int)')).rejects.toThrow(/permission denied/);
  });

  it('gets access to a schema added by a later migration on the next migrate run', async () => {
    await t.owner().query('CREATE SCHEMA later_module');
    await t.owner().query('CREATE TABLE later_module.things (id serial PRIMARY KEY, label text NOT NULL)');
    await expect(t.app().query('SELECT * FROM later_module.things')).rejects.toThrow(/permission denied/);

    await migrateAgain();

    await t.app().query(`INSERT INTO later_module.things (label) VALUES ('a')`);
    await t.app().query(`UPDATE later_module.things SET label = 'b'`);
    const { rows } = await t.app().query<{ label: string }>('SELECT label FROM later_module.things');
    expect(rows).toEqual([{ label: 'b' }]);
    await t.owner().query('DROP SCHEMA later_module CASCADE');
  });

  it('migrating an up-to-date database changes nothing', async () => {
    const journal = () => t.owner().query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations');
    const before = (await journal()).rows;
    await migrateAgain();
    expect((await journal()).rows).toEqual(before);
  });

  // RDS-shaped owners: not superusers, but able to change the schema or mint roles.
  it.each([
    ['CREATEROLE', 'CREATEROLE', ''],
    ['CREATEDB', 'CREATEDB', ''],
    ['CREATE on the database', '', 'GRANT CREATE ON DATABASE {db} TO {role}'],
    ['owning a module schema', '', 'CREATE SCHEMA probe_owned AUTHORIZATION {role}'],
    [
      'membership in a schema owner',
      '',
      'CREATE SCHEMA probe_owned AUTHORIZATION komtru_probe_owner; GRANT komtru_probe_owner TO {role}',
    ],
  ])('refuses a non-superuser with %s', async (_label, attribute, setup) => {
    const role = 'komtru_probe_privileged';
    const owner = t.owner();
    const db = workerDatabase();
    await owner.query(`DROP SCHEMA IF EXISTS probe_owned CASCADE`);
    await owner.query(`DROP ROLE IF EXISTS ${role}`);
    await owner.query(`DROP ROLE IF EXISTS komtru_probe_owner`);
    await owner.query(`CREATE ROLE komtru_probe_owner NOLOGIN`);
    await owner.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER ${attribute} PASSWORD 'probe-pass'`);
    try {
      if (setup) await owner.query(setup.replaceAll('{db}', db).replaceAll('{role}', role));
      const pool = new pg.Pool({
        connectionString: directUrl(db).replace('komtru:komtru@', `${role}:probe-pass@`),
      });
      try {
        await expect(assertNotOwner(pool)).rejects.toBeInstanceOf(RuntimeRoleError);
      } finally {
        await pool.end();
      }
    } finally {
      await owner.query(`DROP SCHEMA IF EXISTS probe_owned CASCADE`);
      await owner.query(`REVOKE ALL ON DATABASE ${db} FROM ${role}`);
      await owner.query(`DROP ROLE ${role}`);
      await owner.query(`DROP ROLE komtru_probe_owner`);
    }
  });

  it('refuses to run the app as the owner', async () => {
    await expect(assertNotOwner(t.owner())).rejects.toBeInstanceOf(RuntimeRoleError);
    await expect(assertNotOwner(t.app())).resolves.toBeUndefined();
  });

  it('lets the runtime role resolve the citext type and its operators', async () => {
    const { rows } = await t
      .app()
      .query<{ same: boolean }>(`SELECT 'Alice'::citext = 'alice'::citext AS same`);
    expect(rows[0]?.same).toBe(true);
  });

  it('gives the runtime role USAGE on public without CREATE', async () => {
    const { rows } = await t.app().query<{ usage: boolean; create: boolean }>(
      `SELECT has_schema_privilege('komtru_app', 'public', 'USAGE') AS usage,
              has_schema_privilege('komtru_app', 'public', 'CREATE') AS create`,
    );
    expect(rows[0]).toEqual({ usage: true, create: false });
  });
});
