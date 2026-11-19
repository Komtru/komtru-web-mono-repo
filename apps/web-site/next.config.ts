import type { NextConfig } from 'next';

/**
 * `@komtru/ui-kit` ships TypeScript sources with `.js` specifiers, so Next has to transpile it
 * rather than treat it as a prebuilt node module. The site reaches into it for the three typefaces
 * and the design tokens, and for nothing else: a marketing page is not built out of app components.
 *
 * `poweredByHeader` off, as everywhere: the header names the framework to anyone scanning and tells
 * a visitor nothing.
 */
const config: NextConfig = {
  transpilePackages: ['@komtru/ui-kit'],
  poweredByHeader: false,
  devIndicators: false,
};

export default config;
