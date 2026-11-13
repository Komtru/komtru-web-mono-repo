// F-037's one read:
//
//   GET /me/viewer   who the app shell is being drawn for: has the caller sold, and are they certified
//
// It lives in trades because "has sold" is a fact about trades; the merchant capability is read through
// identity's barrel, as `readTradePrincipal` already does.
import { viewerFactsSchema } from '@komtru/shared-types';
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import { requireUserId } from '../../../platform/http/principal.js';
import { getViewerFacts, type ViewerDeps } from '../services/viewer.service.js';

/** Read on every sign-in and token refresh, by the web app's server rather than a screen. */
const VIEWER_BUDGET = { points: 60, durationSeconds: 60, by: ['user', 'ip'] as ('user' | 'ip')[] };

export function viewerRoutes(deps: () => ViewerDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/me/viewer',
      scope: 'CONSUMER',
      summary: 'What the app shell shows me: whether I have sold, and whether I am a certified merchant',
      rateLimit: { ...VIEWER_BUDGET },
      schema: { response: viewerFactsSchema },
      handler: (ctx) => getViewerFacts(deps(), requireUserId(ctx.actor, 'Sign in to see your account')),
    }),
  ];
}
