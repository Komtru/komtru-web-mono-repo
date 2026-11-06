// The console's scope enforcement: every navigation needs a sealed STAFF session or goes to
// `/sign-in`. A consumer who lands here is sent to sign-in with `error=wrong-scope` and both
// cookies cleared; there is deliberately no link to the consumer app, so the redirect does not
// confirm what this host is for.
//
// What this is and is not: a redirect, not an authorization boundary. The backend checks the access
// token's scope and the caller's permission on every call, and that is the check that matters.
import { createKomtruMiddleware } from '@komtru/app-kit/next';
import { createSessionSealer, readAppConfig, requireSessionSecret } from '@komtru/app-kit';
import { appSpec } from './src/app-config';
import { PUBLIC_PATHS } from './src/middleware-rules';

export default createKomtruMiddleware({
  config: readAppConfig(appSpec, process.env),
  sealer: createSessionSealer(requireSessionSecret(process.env)),
  publicPaths: PUBLIC_PATHS,
});

/**
 * `KOMTRU_MATCHER`, written out: Next parses this object statically, out of the source, and a
 * spread fails the build. `test/middleware.test.ts` compares the literal against the constant.
 */
export const config = {
  matcher: [
    '/((?!_next/|favicon\\.ico$|.*\\.(?:css|js|mjs|map|json|txt|xml|webmanifest|png|jpg|jpeg|gif|svg|webp|avif|ico|bmp|woff|woff2|ttf|otf|eot|mp4|webm|pdf)$).*)',
  ],
};
