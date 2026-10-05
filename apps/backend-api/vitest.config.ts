import { defineKomtruVitest } from '@komtru/config/vitest';

export default defineKomtruVitest({
  test: {
    // Builds the migrated template database once per run when KOMTRU_INFRA_TESTS=1; no-op otherwise.
    globalSetup: ['test/support/db-global-setup.ts'],
  },
});
