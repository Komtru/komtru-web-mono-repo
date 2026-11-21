import { defineKomtruVitest } from '@komtru/config/vitest';

// Node is the default so a module that reached for `window` fails here rather than inside a Server
// Component; the component suites opt into jsdom with their own `@vitest-environment` docblock.
//
// The JSX runtime is named here because this app's `tsconfig.json` sets `jsx: "preserve"` — Next
// compiles JSX itself — and Vite's transformer reads that setting and then refuses to transform a
// `.tsx` test at all.
export default defineKomtruVitest({
  oxc: { jsx: { runtime: 'automatic' } },
  test: { include: ['test/**/*.test.ts', 'test/**/*.test.tsx'] },
});
