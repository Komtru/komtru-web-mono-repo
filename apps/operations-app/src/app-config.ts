// What this app states about itself, for `@komtru/app-kit`. Committed, not configured: the scope is
// a property of the product, not of the environment.
//
// STAFF only, and no `elsewhereUrlEnv`: a consumer who lands on ops.komtru.com is sent to this app's
// own sign-in rather than pointed at the consumer app. A console is not a public host, and a
// redirect that names the right door is a redirect that confirms this one exists.
import type { AppSpec } from '@komtru/app-kit';

export const appSpec = {
  appName: 'operations-app',
  scope: 'STAFF',
  signInPath: '/sign-in',
  homePath: '/queue',
} as const satisfies AppSpec;
