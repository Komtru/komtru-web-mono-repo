// See `src/auth/invitation-route.ts` for what these routes are and what they refuse.
//
// One catch-all file on purpose: the refresh-token store is module state, and separate route files
// may be bundled apart, so a release in one could never find the sign-in made in another.
//
// Built on the first request, not at module scope: `next build` evaluates every route module, and a
// config read up here would be a read on the machine that builds the app.
import { createAuthRouteHandlers, createMemoryRefreshStore } from '@komtru/app-kit/next';
import { createSessionSealer, readAppConfig, requireSessionSecret } from '@komtru/app-kit';
import { appSpec } from '../../../../src/app-config';
import { createInvitationRoute } from '../../../../src/auth/invitation-route';

type Route = ReturnType<typeof createInvitationRoute>;

/**
 * Fifteen minutes: longer than the 10 minutes a staff access token lives
 * (`STAFF_ACCESS_TOKEN_TTL_SECONDS`, 600) so a slow invitee is still revoked by `release`,
 * short enough that an abandoned page does not leave a 30-day refresh token waiting.
 *
 * In process memory, like the limiter: **move both to Redis before running more than one
 * instance**, or a release can land on an instance that never saw the sign-in.
 */
const STORE_TTL_MS = 15 * 60 * 1000;

let route: Route | undefined;

const build = (): Route => {
  const config = readAppConfig(appSpec, process.env);
  return createInvitationRoute({
    appOrigin: new URL(config.appUrl).origin,
    handlers: createAuthRouteHandlers({
      // The console is STAFF; these routes sign in a CONSUMER account.
      config: { ...config, scope: 'CONSUMER' },
      sealer: createSessionSealer(requireSessionSecret(process.env)),
      tokenMode: { store: createMemoryRefreshStore({ ttlMs: STORE_TTL_MS }) },
    }),
  });
};

export const POST = async (
  request: Request,
  context: { params: Promise<{ action: string[] }> },
): Promise<Response> => (route ??= build())(request, (await context.params).action);

/** Per request; nothing here may be cached. */
export const dynamic = 'force-dynamic';
