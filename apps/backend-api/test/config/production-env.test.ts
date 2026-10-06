// A variable whose DEFAULT is fine in development and wrong in production is invisible: nothing in
// `VARIABLES` marks it, and the only way to discover one is to boot a production process — or, as
// happened here, to watch an unrelated module's integration test fail at setup.
//
// T-050 added the first of those (`TRUST_KYC_PROVIDER`, whose default is a fake KYC adapter) and
// immediately broke notify's production test, which had no way to know. These two assertions close
// the loop: the rules declare the set, the shared fixture satisfies it, and adding a rule without
// teaching the fixture fails here rather than in somebody else's suite.
import { describe, expect, it } from 'vitest';
import { PRODUCTION_ONLY_VARIABLES, loadConfig } from '../../src/config/env.js';
import { testRedisEnv, testRedisUrl } from '../support/db-urls.js';
import { productionProcessEnv } from '../support/production-env.js';

const minimal = {
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: testRedisUrl(),
  ...testRedisEnv(),
};

describe('productionProcessEnv', () => {
  it('supplies every variable a production process must state explicitly', () => {
    const fixture = productionProcessEnv();
    const unsupplied = PRODUCTION_ONLY_VARIABLES.filter((name) => fixture[name] === undefined);
    expect(unsupplied).toEqual([]);
  });

  it('actually builds a production config, which is the only proof that matters', () => {
    const config = loadConfig({ ...minimal, ...productionProcessEnv() });
    expect(config.nodeEnv).toBe('production');
  });

  it('is checking against a rule set that is not empty', () => {
    // If this ever legitimately reaches zero, delete the fixture rather than leaving a test that
    // passes because it is asserting over nothing.
    expect(PRODUCTION_ONLY_VARIABLES.length).toBeGreaterThan(0);
  });
});
