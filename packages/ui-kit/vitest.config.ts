import { defineKomtruVitest } from '@komtru/config/vitest';

// Node is the default: under jsdom, Vite transforms imported modules in web mode and `import.meta.url`
// picks up a `/@fs` prefix, which breaks every file the token tests read. The component tests ask for
// jsdom with a `@vitest-environment` docblock instead.
export default defineKomtruVitest({ test: { include: ['test/**/*.test.{ts,tsx}'] } });
