// Copy to `app/api/auth/[action]/route.ts`. Serves login, refresh and logout; 404s anything else.
//
// This is the only code in the app that touches a refresh token, and the only reason the browser
// never has to hold one.
import { komtruAuthRoute } from '@komtru/app-kit/next';
import { createSessionSealer, readAppConfig, requireSessionSecret } from '@komtru/app-kit';
import { appSpec } from '../../../../src/app-config.js';

export const POST = komtruAuthRoute({
  config: readAppConfig(appSpec, process.env),
  sealer: createSessionSealer(requireSessionSecret(process.env)),
});

/** The cookie is per request; nothing here may be cached or statically rendered. */
export const dynamic = 'force-dynamic';
