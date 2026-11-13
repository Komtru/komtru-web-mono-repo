// The two halves of the viewer seam (F-037) that need no request: reading the viewer's facts from the
// platform when a session is issued, and turning a sealed session hint back into a `Viewer`.
//
// Why the facts travel in the hint at all: a page render holds no credential. The access token lives in
// the browser's memory and the refresh token cookie is scoped to `/api/auth`, so the only thing a Server
// Component can see is `komtru_session`. The auth route holds a fresh access token at exactly the moments
// it writes that cookie, so it reads the facts then (`describeViewer`) and seals them in.
import { createApiClient, getViewerFacts } from '@komtru/api-client';
import type { SessionFacts, SessionHint } from '@komtru/app-kit';
import type { DescribeContext } from '@komtru/app-kit/next';
import { ANONYMOUS_VIEWER, type Viewer } from './nav';

/**
 * The shell for a session hint. Each field is true only when the sealed facts say exactly `true`: no hint,
 * an older hint without facts, or a session of another scope is the anonymous viewer, the smallest shell.
 *
 * `parkAgent` has no platform read yet (the Park hub application, T-091, is not built), so it stays
 * `'none'` and the Account row offers the application.
 */
export function viewerFromHint(hint: SessionHint | null): Viewer {
  if (hint?.scope !== 'CONSUMER' || hint.facts === undefined) return ANONYMOUS_VIEWER;
  return {
    ...ANONYMOUS_VIEWER,
    hasSold: hint.facts.hasSold === true,
    certifiedMerchant: hint.facts.certifiedMerchant === true,
  };
}

export interface DescribeViewerOptions {
  /** The platform's base URL, `/v1` included (`AppConfig.apiUrl`). */
  apiUrl: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * The auth route's `describeSession`: `GET /me/viewer` with the access token just issued, and the real
 * client's forwarded chain and user agent. Without them the platform's per-IP budget on that route would
 * count every person signing in as this one server. One attempt — it sits on the path of every sign-in,
 * and the route seals no facts if it throws.
 */
export function describeViewer({
  apiUrl,
  fetch,
}: DescribeViewerOptions): (accessToken: string, context: DescribeContext) => Promise<SessionFacts> {
  const client = createApiClient({ baseUrl: apiUrl, retry: { maxAttempts: 1 }, ...(fetch ? { fetch } : {}) });
  return async (accessToken, { signal, forwarded }) => {
    // Only the two headers forwarding is for, by name: anything else that arrived (an `authorization` in any
    // casing above all) must not reach the platform beside the token this route was given.
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    for (const [name, value] of Object.entries(forwarded)) {
      const lower = name.toLowerCase();
      if (lower === 'x-forwarded-for' || lower === 'user-agent') headers[lower] = value;
    }
    const facts = await client.call(getViewerFacts, {}, { signal, headers });
    return { hasSold: facts.hasSold, certifiedMerchant: facts.certifiedMerchant };
  };
}
