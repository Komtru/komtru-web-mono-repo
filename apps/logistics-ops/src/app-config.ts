// What this app states about itself, for `@komtru/app-kit`. Committed, not configured: the scope is
// a property of the product, not of the environment.
//
// No `elsewhereUrlEnv`. Middleware only reaches that branch when the held scope differs from the
// required one, and a Park Agent holds the same `LOGISTICS` scope a courier operator does — so it
// could never fire for the case the name suggests, and would fire for a CONSUMER or STAFF session
// by sending that person to park.komtru.com, which will refuse them too. Separating an agent from
// an operator needs the backend's answer about who they are, and that redirect is T-160's.
import type { AppSpec } from '@komtru/app-kit';

export const appSpec = {
  appName: 'logistics-ops',
  scope: 'LOGISTICS',
  signInPath: '/sign-in',
  homePath: '/packages',
} as const satisfies AppSpec;
