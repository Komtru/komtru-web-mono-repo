// `POST /api/invitation/sign-in`: the one route handler that signs in a **consumer** account.
//
// A staff invitation is accepted by the existing account whose verified primary email is the invited
// address (T-038), and that is a CONSUMER call. The console's own auth route refuses a CONSUMER
// session on purpose, and staff sign-in needs a second factor the invitee has not set up yet — so
// the welcome page needs a way in that is not a session.
//
// That is what this is. It logs in at the backend, keeps the refresh token to itself, and returns
// the short-lived access token and nothing else: no cookie is set, so closing the tab ends it, and
// the console's middleware still sees no session. The token buys exactly what a consumer token buys
// (accept this invitation, enrol a second factor) and the backend checks it as it checks any other.
//
// A consumer account that has two-step sign-in on is told to finish through the consumer app: this
// screen has no second-factor step of its own, and the invitee is, by construction, at the start.
import type { AppConfig } from '@komtru/app-kit';
import { z } from 'zod';

const loginRequest = z.object({ identifier: z.string().min(1).max(254), password: z.string().min(1) });

const consumerSession = z.object({
  accessToken: z.string().min(1),
  scope: z.literal('CONSUMER'),
  expiresAt: z.number().int().positive(),
});

const NO_STORE = { 'cache-control': 'no-store' } as const;

const problem = (status: number, code: string, title: string, detail: string): Response =>
  Response.json({ type: 'about:blank', status, code, title, detail }, { status, headers: NO_STORE });

export interface InvitationSignInOptions {
  config: Pick<AppConfig, 'apiUrl'>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export function createInvitationSignIn({
  config,
  fetch: fetchImpl,
  timeoutMs = 15_000,
}: InvitationSignInOptions): (request: Request) => Promise<Response> {
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);

  return async (request) => {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      raw = undefined;
    }
    const body = loginRequest.safeParse(raw);
    if (!body.success) {
      return problem(422, 'VALIDATION_FAILED', 'That is not a sign-in', 'Send an identifier and a password');
    }

    let upstream: Response;
    try {
      upstream = await doFetch(`${config.apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body.data),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return problem(502, 'BAD_GATEWAY', 'Sign-in is unavailable', 'The platform did not answer; try again');
    }

    const payload = (await upstream.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    if (!upstream.ok) return Response.json(payload ?? {}, { status: upstream.status, headers: NO_STORE });

    if (payload?.mfaRequired === true) {
      return problem(
        409,
        'MFA_NOT_SUPPORTED',
        'This account has two-step sign-in on',
        'Turn it off in the consumer app for now, accept the invitation, then set it up again here',
      );
    }

    const session = consumerSession.safeParse(payload);
    if (!session.success) {
      return problem(
        403,
        'WRONG_SCOPE',
        'This account cannot accept an invitation',
        'Use the account the invitation was sent to',
      );
    }
    return Response.json(
      { accessToken: session.data.accessToken, expiresAt: session.data.expiresAt },
      { status: 200, headers: NO_STORE },
    );
  };
}
