// Shared Vitest defaults. Workspaces call defineKomtruVitest() and pass only what differs.
import { defineConfig, mergeConfig } from 'vitest/config';

const base = defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'test/fixtures/**'],
    passWithNoTests: false,
    restoreMocks: true,
  },
});

/** @param {import('vitest/config').ViteUserConfig} [overrides] */
export function defineKomtruVitest(overrides = {}) {
  return mergeConfig(base, overrides);
}

export default defineKomtruVitest;
