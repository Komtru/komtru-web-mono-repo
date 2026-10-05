// The per-worker test database harness itself. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { infraEnabled, pooledPort } from '../support/db-urls.js';
import { useTestDatabase, workerDatabase } from '../support/db.js';

describe.runIf(infraEnabled)('test database harness', () => {
  const t = useTestDatabase();

  it('gives each worker its own database, reached through PgBouncer', async () => {
    const { rows } = await t.app().query<{ db: string }>('SELECT current_database() AS db');
    expect(rows[0]?.db).toBe(workerDatabase());
    expect(t.app().options.port ?? Number(new URL(t.app().options.connectionString ?? '').port)).toBe(
      pooledPort(),
    );
  });

  it('starts every test empty (1/2: write a row)', async () => {
    await t.owner().query('CREATE TABLE IF NOT EXISTS platform.harness_probe (id int)');
    await t.owner().query('INSERT INTO platform.harness_probe VALUES (1)');
    const { rows } = await t.owner().query('SELECT * FROM platform.harness_probe');
    expect(rows).toHaveLength(1);
  });

  it('starts every test empty (2/2: the row is gone)', async () => {
    const { rows } = await t.owner().query('SELECT * FROM platform.harness_probe');
    expect(rows).toHaveLength(0);
    await t.owner().query('DROP TABLE platform.harness_probe');
  });
});
