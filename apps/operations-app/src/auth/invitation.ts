// The client half of the invitation routes (`/api/invitation/*`): a consumer sign-in that returns a
// bearer token and no session, for a page that accepts a staff invitation and sets up a second
// factor. See `invitation-route.ts` for what the server half refuses.
import { isChallenge, messageFor, post, readBody, type Challenge, type CodeResult } from './sign-in';

export const INVITATION_PATHS = {
  login: '/api/invitation/sign-in',
  mfa: '/api/invitation/mfa',
  mfaChallenge: '/api/invitation/mfa-challenge',
  release: '/api/invitation/release',
} as const;

export type InvitationLoginResult =
  | { kind: 'session'; accessToken: string }
  | { kind: 'challenge'; challenge: Challenge }
  | { kind: 'error'; message: string };

export type InvitationCodeResult =
  { kind: 'session'; accessToken: string } | Exclude<CodeResult, { kind: 'ok' }>;

const UNAVAILABLE = 'Sign-in is unavailable right now. Try again in a moment.';

const messageForInvitation = (status: number, code: unknown): string =>
  status === 400
    ? 'This invitation link is not valid. Ask your team lead to send a new one.'
    : messageFor(status, code);

/** The token goes in the body, never the URL; the server refuses a sign-in that does not carry one. */
export async function invitationLogin(
  input: { identifier: string; password: string; invitationToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<InvitationLoginResult> {
  try {
    const response = await post(INVITATION_PATHS.login, input, fetchImpl);
    const body = await readBody(response);
    if (!response.ok) return { kind: 'error', message: messageForInvitation(response.status, body.code) };
    if (typeof body.accessToken === 'string') return { kind: 'session', accessToken: body.accessToken };
    if (isChallenge(body)) {
      return {
        kind: 'challenge',
        challenge: { mfaToken: body.mfaToken, expiresAt: body.expiresAt, factors: body.factors },
      };
    }
    return { kind: 'error', message: UNAVAILABLE };
  } catch {
    return { kind: 'error', message: UNAVAILABLE };
  }
}

export async function invitationCode(
  input: { mfaToken: string; factorId: string; code: string },
  fetchImpl: typeof fetch = fetch,
): Promise<InvitationCodeResult> {
  try {
    const response = await post(INVITATION_PATHS.mfa, input, fetchImpl);
    const body = await readBody(response);
    if (response.ok && typeof body.accessToken === 'string') {
      return { kind: 'session', accessToken: body.accessToken };
    }
    if (response.status === 401) {
      const left = body.attemptsRemaining;
      const tail =
        typeof left === 'number' ? ` ${String(left)} ${left === 1 ? 'attempt' : 'attempts'} left.` : '';
      return { kind: 'wrong', message: `That code did not work.${tail}` };
    }
    return { kind: 'error', message: response.ok ? UNAVAILABLE : messageFor(response.status, body.code) };
  } catch {
    return { kind: 'error', message: UNAVAILABLE };
  }
}

/**
 * Ends the consumer session behind the bearer token. Fire and forget: the page is done with the
 * token whether or not the platform answers, and the server sweeps what an unanswered call leaves.
 */
export async function releaseInvitationSession(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await post(INVITATION_PATHS.release, {}, fetchImpl, { authorization: `Bearer ${accessToken}` }).catch(
    () => undefined,
  );
}
