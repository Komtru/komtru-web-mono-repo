// Pins the geo schema's surface so a later ticket cannot quietly drop a table, an index or the
// no-delete rule. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { seedLocations } from '../../../src/modules/geo/services/seed.service.js';
import { createDb } from '../../../src/db/index.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';

describe.runIf(infraEnabled)('geo schema census (T-046)', () => {
  const t = useTestDatabase();
  const rows = async <T extends object>(sql: string, params: unknown[] = []) =>
    (await t.owner().query<T>(sql, params)).rows;

  it('holds exactly states, cities and city_requests', async () => {
    const tables = await rows<{ t: string }>(
      `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'geo' ORDER BY 1`,
    );
    expect(tables.map((r) => r.t)).toEqual(['cities', 'city_requests', 'states']);
  });

  it('has the unique indexes that stop a city being added twice', async () => {
    const idx = await rows<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'geo'`,
    );
    const names = idx.map((i) => i.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        'cities_state_normalised_name_unique',
        'cities_seed_key_unique',
        'states_code_unique',
        'states_normalised_name_unique',
        'city_requests_pending_per_user',
      ]),
    );
    const unique = idx.find((i) => i.indexname === 'cities_state_normalised_name_unique');
    expect(unique?.indexdef).toMatch(/UNIQUE.*\(state_id, normalised_name\)/);
    const pending = idx.find((i) => i.indexname === 'city_requests_pending_per_user');
    expect(pending?.indexdef).toMatch(/WHERE.*status.*PENDING/);
  });

  it('indexes the typeahead prefix with text_pattern_ops', async () => {
    const [prefix] = await rows<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'cities_normalised_name_prefix_idx'`,
    );
    expect(prefix?.indexdef).toContain('text_pattern_ops');
  });

  it('refuses a request whose decision columns do not match its status', async () => {
    await seedLocations(createDb(t.app()));
    const [state] = await rows<{ id: string }>(`SELECT id FROM geo.states LIMIT 1`);
    await expect(
      t.owner().query(
        `INSERT INTO geo.city_requests (requested_by_user_id, state_id, city_name, normalised_name, status)
         VALUES (gen_random_uuid(), $1, 'X', 'x', 'REJECTED')`,
        [state?.id],
      ),
    ).rejects.toThrow(/city_requests_decision_shape/);
  });

  it('never deletes a city or a state, for anyone, and the app role has no DELETE grant', async () => {
    await seedLocations(createDb(t.app()));
    for (const table of ['cities', 'states']) {
      await expect(t.owner().query(`DELETE FROM geo.${table}`)).rejects.toMatchObject({ code: 'KT002' });
      await expect(t.app().query(`DELETE FROM geo.${table}`)).rejects.toThrow();
    }
    const [counted] = await rows<{ n: string }>(`SELECT count(*) AS n FROM geo.states`);
    expect(Number(counted?.n)).toBe(37);
  });
});
