// What this app states about itself, for `@komtru/app-kit`. Committed, not configured: the scope is
// a property of the product, not of the environment.
//
// A Park Agent holds a LOGISTICS session too, so scope alone cannot separate this app from
// park.komtru.com: T-160 redirects an agent there after asking the backend who they are.
// `elsewhereUrlEnv` covers only the scope mismatch middleware can see without a round trip.
import type { AppSpec } from '@komtru/app-kit';

export const appSpec = {
  appName: 'logistics-ops',
  scope: 'LOGISTICS',
  signInPath: '/sign-in',
  homePath: '/packages',
  elsewhereUrlEnv: 'NEXT_PUBLIC_KOMTRU_PARK_URL',
} as const satisfies AppSpec;
