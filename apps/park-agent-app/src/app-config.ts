// What this app states about itself, for `@komtru/app-kit`. Committed, not configured: the scope is
// a property of the product, not of the environment.
//
// LOGISTICS, the same scope logistics.komtru.com requires: Park Agents sign in through the
// logistics route (design §7.3), which is why there is no fourth scope. That is also why there is
// no `elsewhereUrlEnv` — middleware only fires it on a scope mismatch, and between these two apps
// there is none. Sending a non-Park member back to logistics.komtru.com is T-170's, after the
// backend has said who they are.
import type { AppSpec } from '@komtru/app-kit';

export const appSpec = {
  appName: 'park-agent-app',
  scope: 'LOGISTICS',
  signInPath: '/sign-in',
  homePath: '/',
} as const satisfies AppSpec;
