// The runtime role's privileges, against a migrated database. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { assertNotOwner, RuntimeRoleError } from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrator.js';
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

  it('refuses to run the app as the owner', async () => {
    await expect(assertNotOwner(t.owner())).rejects.toBeInstanceOf(RuntimeRoleError);
    await expect(assertNotOwner(t.app())).resolves.toBeUndefined();
  });
});
