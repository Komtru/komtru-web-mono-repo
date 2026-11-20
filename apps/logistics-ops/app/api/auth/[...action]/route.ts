// Login, the second factor, refresh and logout; 404s anything else.
//
// The portal's backend routes are the logistics ones (T-086): `/auth/logistics/login` answers a
// password with a LOGISTICS session (or a challenge, when the account has a second factor), and
// `403 NO_LOGISTICS_ACCESS` — passed through verbatim — when the account has no company. The consumer
// routes would answer with a consumer session, which this app's scope check would then refuse.
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
    loginPath: '/auth/logistics/login',
    mfaVerifyPath: '/auth/logistics/mfa/verify',
    // One challenge route serves every scope: it sends the code for a factor named by the token.
    mfaChallengePath: '/auth/mfa/challenge',
  }));

export const POST: Handler = (request, context) => route()(request, context);

/** The cookie is per request; nothing here may be cached or statically rendered. */
export const dynamic = 'force-dynamic';
