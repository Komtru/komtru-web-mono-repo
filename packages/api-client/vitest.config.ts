import { defineKomtruVitest } from '@komtru/config/vitest';

// The React bindings are .tsx and a few suites opt into jsdom with their own docblock; everything
// else stays on the node environment, so an isomorphic module that reached for `window` would fail.
export default defineKomtruVitest({
  test: { include: ['test/**/*.test.ts', 'test/**/*.test.tsx', 'src/**/*.test.ts'] },
});
