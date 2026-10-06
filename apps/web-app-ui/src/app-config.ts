// What this app states about itself, for `@komtru/app-kit`. Committed, not configured: the scope is
// a property of the product, not of the environment.
//
// Everyone who buys or sells is a CONSUMER session (design C22, §7.3). There is no buyer or seller
// scope, and no role switcher.
import type { AppSpec } from '@komtru/app-kit';

export const appSpec = {
  appName: 'web-app-ui',
  scope: 'CONSUMER',
  signInPath: '/sign-in',
  homePath: '/trades',
} as const satisfies AppSpec;
