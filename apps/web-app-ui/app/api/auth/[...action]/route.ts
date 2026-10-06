// Login, refresh and logout; 404s anything else.
//
// A catch-all segment, not `[action]`: `komtruAuthRoute` reads `params.action` as the segments after
// `/api/auth`, and 404s anything that is not exactly one of the three.
//
// This is the only code in the app that touches a refresh token, and the only reason the browser
// never has to hold one.
import { komtruAuthRoute } from '@komtru/app-kit/next';
import { createSessionSealer, requireSessionSecret } from '@komtru/app-kit';
import { readWebAppConfig } from '../../../../src/app-config';

export const POST = komtruAuthRoute({
  config: readWebAppConfig(process.env),
  sealer: createSessionSealer(requireSessionSecret(process.env)),
});

/** The cookie is per request; nothing here may be cached or statically rendered. */
export const dynamic = 'force-dynamic';
