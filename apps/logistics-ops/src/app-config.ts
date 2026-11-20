// What this app states about itself, for `@komtru/app-kit`. Committed, not configured: the scope is
// a property of the product, not of the environment.
//
// No `elsewhereUrlEnv`. Middleware only reaches that branch when the held scope differs from the
// required one, and a Park Agent holds the same `LOGISTICS` scope a courier operator does — so it
// could never fire for the case the name suggests, and would fire for a CONSUMER or STAFF session
// by sending that person to park.komtru.com, which will refuse them too. Separating an agent from
// an operator needs the backend's answer about who they are: `GET /logistics/me` names the company,
// and a member of Park (the default company) is sent to the Park app (T-160, `src/auth/park.ts`).
//
// Home is the Team screen until package requests land (T-162): a nav item for a screen that does not
// exist yet would be a stub, and the definition of done refuses those.
import type { AppSpec } from '@komtru/app-kit';

export const appSpec = {
  appName: 'logistics-ops',
  scope: 'LOGISTICS',
  signInPath: '/sign-in',
  homePath: '/team',
} as const satisfies AppSpec;

/** Where a Park Agent who signs in here belongs. Inlined by Next from the public env. */
export const PARK_URL_ENV = 'NEXT_PUBLIC_KOMTRU_PARK_URL';
