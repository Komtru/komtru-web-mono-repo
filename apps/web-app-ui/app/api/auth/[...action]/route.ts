// Login, refresh and logout; 404s anything else.
//
// A catch-all segment, not `[action]`: `komtruAuthRoute` reads `params.action` as the segments after
// `/api/auth`, and 404s anything that is not exactly one of the three.
//
// This is the only code in the app that touches a refresh token, and the only reason the browser
// never has to hold one.
//
// The handler is built on the first request rather than at module scope. `next build` evaluates
// every route module to collect page data, so a config read up here is a read on the machine that
// *builds* the app — which is not where its environment lives, and which made `pnpm build` fail on
// a clean checkout. Deferring changes nothing about how loudly a real misconfiguration fails: the
// first request still throws, naming the variable.
import { komtruAuthRoute } from '@komtru/app-kit/next';
import { createSessionSealer, readAppConfig, requireSessionSecret } from '@komtru/app-kit';
import { appSpec } from '../../../../src/app-config';
import { describeViewer } from '../../../../src/shell/viewer-facts';

type Handler = ReturnType<typeof komtruAuthRoute>;

let handler: Handler | undefined;

const route = (): Handler => {
  if (handler !== undefined) return handler;
  // `readAppConfig`, not `readWebAppConfig`: signing in needs the API URL, and nothing here has
  // any use for where the passport pages or the Park Agent app are served.
  const config = readAppConfig(appSpec, process.env);
  handler = komtruAuthRoute({
    config,
    sealer: createSessionSealer(requireSessionSecret(process.env)),
    // F-037: who the shell is drawn for (has sold, is certified), read with each new access token and
    // sealed into the session hint, which is all `resolveViewer` can see from a page render.
    describeSession: describeViewer({ apiUrl: config.apiUrl }),
  });
  return handler;
};

export const POST: Handler = (request, context) => route()(request, context);

/** The cookie is per request; nothing here may be cached or statically rendered. */
export const dynamic = 'force-dynamic';
