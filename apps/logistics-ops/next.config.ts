import type { NextConfig } from 'next';

/**
 * `@komtru/*` are workspace packages shipped as TypeScript sources with `.js` specifiers, so Next
 * has to transpile them rather than treat them as prebuilt node modules.
 *
 * A partner portal is not something to be indexed or framed: the security headers say so.
 */
const config: NextConfig = {
  transpilePackages: ['@komtru/api-client', '@komtru/app-kit', '@komtru/shared-types', '@komtru/ui-kit'],
  poweredByHeader: false,
  devIndicators: false,
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ]);
  },
};

export default config;
