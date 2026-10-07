import type { NextConfig } from 'next';

/**
 * `@komtru/*` are workspace packages shipped as TypeScript sources with `.js` specifiers, so Next
 * has to transpile them rather than treat them as prebuilt node modules.
 *
 * `poweredByHeader` off: the header names the framework to anyone scanning, and tells a visitor
 * nothing.
 */
const config: NextConfig = {
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
