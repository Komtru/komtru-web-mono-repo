// Database names must change with the run id: two runs that share KOMTRU_TEST_DB_PREFIX would otherwise
// drop each other's worker databases mid-run. Unit test: needs no Postgres.
import { afterEach, describe, expect, it } from 'vitest';
import { templateDatabaseName } from './db-urls.js';
import { workerDatabase } from './db.js';

const saved = { run: process.env.KOMTRU_TEST_RUN_ID, pool: process.env.VITEST_POOL_ID };

describe('database names', () => {
  afterEach(() => {
    if (saved.run === undefined) delete process.env.KOMTRU_TEST_RUN_ID;
    else process.env.KOMTRU_TEST_RUN_ID = saved.run;
    if (saved.pool === undefined) delete process.env.VITEST_POOL_ID;
    else process.env.VITEST_POOL_ID = saved.pool;
  });

  it('gives two runs with the same worker id different worker databases', () => {
    process.env.VITEST_POOL_ID = '3';
    process.env.KOMTRU_TEST_RUN_ID = 'runaaaa';
    const first = workerDatabase();
    process.env.KOMTRU_TEST_RUN_ID = 'runbbbb';
    const second = workerDatabase();
    expect(first).not.toEqual(second);
    expect(first).toContain('runaaaa');
    expect(second).toContain('runbbbb');
  });

  it('gives two runs different templates, so one run cannot drop the other’s', () => {
    process.env.KOMTRU_TEST_RUN_ID = 'runaaaa';
    const first = templateDatabaseName();
    process.env.KOMTRU_TEST_RUN_ID = 'runbbbb';
    expect(templateDatabaseName()).not.toEqual(first);
  });

  it('stays inside Postgres’s 63-byte identifier limit for a realistic run id', () => {
    process.env.VITEST_POOL_ID = '16';
    process.env.KOMTRU_TEST_RUN_ID = 'm3k9x2ab' + '0123456789abcdef'.slice(0, 6);
    expect(workerDatabase().length).toBeLessThanOrEqual(63);
    expect(templateDatabaseName().length).toBeLessThanOrEqual(63);
  });
});
