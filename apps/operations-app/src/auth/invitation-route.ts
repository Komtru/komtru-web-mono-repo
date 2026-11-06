// `/api/invitation/*`: the doors a staff invitee uses before they have any staff session.
//
// A staff invitation is accepted by the existing account whose verified primary email is the invited
// address (T-038), and that is a CONSUMER call. The console's own auth route refuses a CONSUMER
// session on purpose, and staff sign-in needs a second factor the invitee has not set up yet. So
// these routes are `createAuthRouteHandlers` in **token mode** with the consumer backend routes:
// they return an access token and no cookie, keep the refresh token in a server-side store, and
// revoke the session through `release` when the flow ends.
//
// What stops this being an open login proxy for the consumer API:
//   * `sign-in` refuses a body without a plausible invitation token (400), so it is not a general
//     password oracle behind this host. A token is not proof of a real invitation, only a floor; the
//     real checks are the backend's per-IP and per-identifier limits, which see the true client
//     because the handlers forward `X-Forwarded-For` and the user agent, and the limiter in front.
//   * Every route needs `application/json` from this app's own origin.
//   * `mfa` and `mfa-challenge` need a challenge token the backend minted for a login.
import { checkSameOriginJson, type AuthRouteHandlers } from '@komtru/app-kit/next';

/** The shape the backend's tokens have: opaque, 20 to 128 characters, no whitespace. */
const INVITATION_TOKEN = /^\S{20,128}$/;

const NO_STORE = { 'cache-control': 'no-store' } as const;

const problem = (status: number, code: string, title: string, detail: string): Response =>
  Response.json({ type: 'about:blank', status, code, title, detail }, { status, headers: NO_STORE });

export interface InvitationRouteOptions {
  handlers: AuthRouteHandlers;
  appOrigin: string;
}

export function createInvitationRoute({
  handlers,
  appOrigin,
}: InvitationRouteOptions): (request: Request, action: string[]) => Promise<Response> {
  return async (request, action) => {
    const name = action.length === 1 ? action[0] : undefined;

    if (name === 'sign-in') {
      // The origin check is the handler's too, but it must come first: a cross-site page should be
      // told 403, not learn what the 400 below is about.
      const reason = checkSameOriginJson(request, appOrigin);
      if (reason !== null) return problem(403, 'FORBIDDEN', 'That request was refused', reason);

      let raw: unknown;
      try {
        raw = await request.clone().json();
      } catch {
        raw = undefined;
      }
      const token = (raw as { invitationToken?: unknown } | undefined)?.invitationToken;
      if (typeof token !== 'string' || !INVITATION_TOKEN.test(token)) {
        return problem(
          400,
          'INVITATION_TOKEN_REQUIRED',
          'This sign-in needs an invitation',
          'Open the link in your invitation email',
        );
      }
      return handlers.login(request);
    }
    if (name === 'mfa') return handlers.mfa(request);
    if (name === 'mfa-challenge') return handlers.mfaChallenge(request);
    if (name === 'release') return handlers.release(request);
    return problem(
      404,
      'NOT_FOUND',
      'No such route',
      'Only sign-in, mfa, mfa-challenge and release exist here',
    );
  };
}
