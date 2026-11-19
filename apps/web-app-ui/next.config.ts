import type { NextConfig } from 'next';

/**
 * `@komtru/*` are workspace packages shipped as TypeScript sources with `.js` specifiers, so Next
 * has to transpile them rather than treat them as prebuilt node modules.
 *
 * `poweredByHeader` off: the header names the framework to anyone scanning, and tells a visitor
 * nothing.
 */
const config: NextConfig = {
  // A visual check builds this app for production and serves it with `next start`, while a `pnpm
  // dev` server is usually already running. Both default to `.next`, and the build wipes
  // `.next/static/chunks` — which deletes the dev-only runtime chunks (`app-pages-internals.js`,
  // `polyfills.js`) that the running dev server emitted once at start-up and never re-emits. The
  // dev server then keeps serving HTML referencing them, the browser 404s, the app never hydrates,
  // and every form on it falls back to a native submit that reloads the page. Giving the
  // visual-check build its own directory keeps the two out of each other's way.
  ...(process.env.KOMTRU_NEXT_DIST_DIR === undefined
    ? {}
    : {
        distDir: process.env.KOMTRU_NEXT_DIST_DIR,
        // Next rewrites the `include` of whichever tsconfig it is given to point at its `distDir`,
        // so the check gets its own copy and `tsconfig.json` stays as committed.
        typescript: { tsconfigPath: 'tsconfig.visual-check.json' },
      }),
  transpilePackages: ['@komtru/api-client', '@komtru/app-kit', '@komtru/shared-types', '@komtru/ui-kit'],
  poweredByHeader: false,
  // The dev-server badge floats over the bottom-left of every screen, which is where the tab bar is
  // and where the visual check (T-016) compares it against the reference.
  devIndicators: false,
  headers() {
    return Promise.resolve([
      {
        // The service worker is scoped to the path it is served from, so a worker that must control
        // every route has to be served from the root with no caching in front of it — otherwise a
        // fixed worker sits in the browser's HTTP cache for a day while the app it caches moves on.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]);
  },
};

export default config;
