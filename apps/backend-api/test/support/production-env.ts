// The variables a production process must state explicitly, in one place.
//
// Same shape and same reason as `identity-env.ts` (T-035): a module refuses to boot without
// something, every suite that boots a real process has to supply it, and those suites build their
// environment by hand — so the next one to be added goes missing from a builder that had no reason
// to know about it. T-050's `TRUST_KYC_PROVIDER` did exactly that to notify's production test.
//
// `PRODUCTION_ONLY_VARIABLES` is derived from the rules `loadConfig` actually enforces, and
// `test/config/production-env.test.ts` fails if a new rule is not represented here.
import { PRODUCTION_ONLY_VARIABLES } from '../../src/config/env.js';

/**
 * `NODE_ENV=production` plus a valid value for every production-only rule.
 *
 * `DOJAH` rather than `FAKE` for the KYC provider: it is the adapter a real deployment would name,
 * and the whole point of the rule is that the fake cannot be the answer in production. A test
 * asserting the REFUSAL should build its environment by hand rather than reach for this.
 */
export const productionProcessEnv = (): Record<string, string> => {
  const env: Record<string, string> = {
    NODE_ENV: 'production',
    TRUST_KYC_PROVIDER: 'DOJAH',
  };
  // Not a silent gap: a rule with no value here is a fixture that no longer does its job, and the
  // suite that discovers it should not be somebody else's.
  const unsupplied = PRODUCTION_ONLY_VARIABLES.filter((name) => env[name] === undefined);
  if (unsupplied.length > 0) {
    throw new Error(`productionProcessEnv(): no value for ${unsupplied.join(', ')}`);
  }
  return env;
};
