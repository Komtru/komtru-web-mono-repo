import { defineKomtruVitest } from '@komtru/config/vitest';

export default defineKomtruVitest({
  test: {
    // Builds the migrated template database once per run when KOMTRU_INFRA_TESTS=1; no-op otherwise.
    globalSetup: ['test/support/db-global-setup.ts'],
    // Unit runs stay fully parallel: they touch nothing shared and the cost is startup only.
    //
    // An infra run does not. Every worker clones the template database, and Postgres allows 100
    // connections against PgBouncer's 200 client slots — so at full width the suite spends them on
    // itself and fails with `Connection terminated due to connection timeout` or a `beforeAll` that
    // timed out doing DDL, in whichever file lost. That reads as a bug in that file and never is.
    // Eight is empirical: 20 consecutive clean runs at the same wall time as the unbounded suite,
    // where unbounded managed 16.
    ...(process.env.KOMTRU_INFRA_TESTS === '1' ? { maxWorkers: 8 } : {}),
  },
});
