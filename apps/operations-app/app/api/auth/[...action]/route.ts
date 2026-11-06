// Login, the second factor, refresh and logout; 404s anything else.
//
// The console's backend routes are the staff ones: a password buys a challenge and only the second
// factor opens a session (`/auth/staff/*`, T-037). The consumer routes would answer a staff login
// with a consumer session, which this app's scope check would then refuse.
//
// The handler is built on the first request rather than at module scope: `next build` evaluates
// every route module, and a config read up here is a read on the machine that builds the app.
import { komtruAuthRoute } from '@komtru/app-kit/next';
import { createSessionSealer, readAppConfig, requireSessionSecret } from '@komtru/app-kit';
import { appSpec } from '../../../../src/app-config';

type Handler = ReturnType<typeof komtruAuthRoute>;

let handler: Handler | undefined;

const route = (): Handler =>
  (handler ??= komtruAuthRoute({
    config: readAppConfig(appSpec, process.env),
    sealer: createSessionSealer(requireSessionSecret(process.env)),
    loginPath: '/auth/staff/login',
    mfaVerifyPath: '/auth/staff/mfa/verify',
    // One challenge route serves both scopes: it sends the code for a factor named by the token.
    mfaChallengePath: '/auth/mfa/challenge',
  }));

export const POST: Handler = (request, context) => route()(request, context);

/** The cookie is per request; nothing here may be cached or statically rendered. */
export const dynamic = 'force-dynamic';
