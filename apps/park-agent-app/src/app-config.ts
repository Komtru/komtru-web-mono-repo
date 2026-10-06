// What this app states about itself, for `@komtru/app-kit`. Committed, not configured: the scope is
// a property of the product, not of the environment.
//
// LOGISTICS, the same scope logistics.komtru.com requires: Park Agents sign in through the
// logistics route (design §7.3), which is why there is no fourth scope. A non-Park member of a
// logistics company is sent back to logistics.komtru.com.
import type { AppSpec } from '@komtru/app-kit';

export const appSpec = {
  appName: 'park-agent-app',
  scope: 'LOGISTICS',
  signInPath: '/sign-in',
  homePath: '/',
  elsewhereUrlEnv: 'NEXT_PUBLIC_KOMTRU_LOGISTICS_URL',
} as const satisfies AppSpec;
