import { defineKomtruVitest } from '@komtru/config/vitest';

// Node is the default so an isomorphic module that reached for `window` fails here rather than in a
// Server Component; the React suites opt into jsdom with their own `@vitest-environment` docblock.
export default defineKomtruVitest({
  test: { include: ['test/**/*.test.ts', 'test/**/*.test.tsx'] },
});
