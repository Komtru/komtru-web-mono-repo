import { defineKomtruVitest } from '@komtru/config/vitest';

// Node by default; the component suites opt into jsdom with their own `@vitest-environment`
// docblock. The JSX runtime is named because `tsconfig.json` sets `jsx: "preserve"` for Next, and
// Vite's transformer otherwise refuses to transform a `.tsx` test at all.
export default defineKomtruVitest({
  oxc: { jsx: { runtime: 'automatic' } },
  test: { include: ['test/**/*.test.ts', 'test/**/*.test.tsx'] },
});
