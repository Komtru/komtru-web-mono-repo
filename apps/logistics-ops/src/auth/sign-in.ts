// What the sign-in screen does, as plain functions over `fetch`: the screen is the part worth looking
// at, and this is the part worth testing.
//
// Every call goes to this app's own route handlers (`/api/auth/*`), never to the backend, so the
// refresh token stays in an httpOnly cookie and the browser only ever holds the access token.
//
// The screen doubles as invitation acceptance (m2 §8): there is no token and no accept page. A first
// successful sign-in by an invited member is what activates them, on the backend.
import { authRoutePaths } from '@komtru/api-client';

export type FactorType = 'TOTP' | 'SMS_OTP' | 'EMAIL_OTP' | 'PASSKEY' | 'RECOVERY_CODE';

export interface Factor {
  id: string;
  type: FactorType;
  hint: string | null;
  isDefault: boolean;
}

export interface Challenge {
  mfaToken: string;
  expiresAt: number;
  factors: readonly Factor[];
}

export type PasswordResult =
  /** Signed in: the cookie is set and the next request carries a LOGISTICS session. */
  | { kind: 'session' }
  /** The account has a second factor: the password bought a challenge, not a session. */
  | { kind: 'challenge'; challenge: Challenge }
  /** The password was right and the account belongs to no logistics company (403 NO_LOGISTICS_ACCESS). */
  | { kind: 'no-access' }
  | { kind: 'error'; message: string };

export type SendResult = { kind: 'sent'; destination: string | null } | { kind: 'error'; message: string };
export type CodeResult =
  | { kind: 'ok' }
  | { kind: 'no-access' }
  /** The code was wrong and another try is allowed. */
  | { kind: 'wrong'; message: string }
  | { kind: 'error'; message: string };

export const UNAVAILABLE = 'Sign-in is unavailable right now. Try again in a moment.';

/** The copy T-160 names, distinct from a wrong password: the password may be entirely right. */
export const NO_ACCESS_TITLE = "This account isn't attached to a logistics company";
export const NO_ACCESS_BODY =
  'Your Komtru sign-in worked, but no logistics company has added you to its team. Ask your company admin to add you with this email or phone, then sign in again.';

/**
 * A path on this host and nothing else. `//evil.com` and `/\evil.com` resolve to another origin once
 * a router follows them, so anything that is not plainly a same-site path is dropped.
 */
export function safeNext(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return undefined;
  return value;
}

/** A passkey needs the browser's WebAuthn ceremony, which this screen does not run. */
export const usableFactors = (factors: readonly Factor[]): Factor[] =>
  factors.filter((factor) => factor.type !== 'PASSKEY');

export function defaultFactor(factors: readonly Factor[]): Factor | undefined {
  const usable = usableFactors(factors);
  return usable.find((factor) => factor.isDefault) ?? usable[0];
}

/** SMS and email factors send a code when asked; an authenticator app and a recovery code do not. */
export const needsSend = (factor: Factor): boolean =>
  factor.type === 'SMS_OTP' || factor.type === 'EMAIL_OTP';

const readBody = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const post = (path: string, body: unknown, fetchImpl: typeof fetch): Promise<Response> =>
  fetchImpl(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export const isNoAccess = (status: number, code: unknown): boolean =>
  status === 403 && code === 'NO_LOGISTICS_ACCESS';

/** One voice for a wrong password and an unknown account: the platform says the same. */
export const messageFor = (status: number, code: unknown): string => {
  if (status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (status === 403 && code === 'WRONG_SCOPE') return 'This account cannot sign in to the logistics portal.';
  if (status === 401)
    return 'That sign-in did not match. Check your email or phone and password, and try again.';
  if (status === 422) return 'Enter your email or phone, and your password.';
  return UNAVAILABLE;
};

const isChallenge = (body: Record<string, unknown>): body is Record<string, unknown> & Challenge =>
  body.mfaRequired === true &&
  typeof body.mfaToken === 'string' &&
  typeof body.expiresAt === 'number' &&
  Array.isArray(body.factors);

export async function submitPassword(
  credentials: { identifier: string; password: string },
  fetchImpl: typeof fetch = fetch,
): Promise<PasswordResult> {
  try {
    const response = await post(authRoutePaths().login, credentials, fetchImpl);
    const body = await readBody(response);
    if (!response.ok) {
      if (isNoAccess(response.status, body.code)) return { kind: 'no-access' };
      return { kind: 'error', message: messageFor(response.status, body.code) };
    }
    if (isChallenge(body)) {
      return {
        kind: 'challenge',
        challenge: { mfaToken: body.mfaToken, expiresAt: body.expiresAt, factors: body.factors },
      };
    }
    return body.scope === 'LOGISTICS' ? { kind: 'session' } : { kind: 'error', message: UNAVAILABLE };
  } catch {
    return { kind: 'error', message: UNAVAILABLE };
  }
}

export async function sendCode(
  input: { mfaToken: string; factorId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  try {
    const response = await post(authRoutePaths().mfaChallenge, input, fetchImpl);
    const body = await readBody(response);
    if (!response.ok) return { kind: 'error', message: messageFor(response.status, body.code) };
    if (body.delivered === false) {
      return { kind: 'error', message: 'We could not send a code just now. Wait a minute and try again.' };
    }
    return {
      kind: 'sent',
      destination: typeof body.maskedDestination === 'string' ? body.maskedDestination : null,
    };
  } catch {
    return { kind: 'error', message: UNAVAILABLE };
  }
}

export async function submitCode(
  input: { mfaToken: string; factorId: string; code: string },
  fetchImpl: typeof fetch = fetch,
): Promise<CodeResult> {
  try {
    const response = await post(authRoutePaths().mfa, input, fetchImpl);
    const body = await readBody(response);
    if (response.ok) return { kind: 'ok' };
    if (isNoAccess(response.status, body.code)) return { kind: 'no-access' };
    if (response.status === 401) {
      const left = body.attemptsRemaining;
      const tail =
        typeof left === 'number' ? ` ${String(left)} ${left === 1 ? 'attempt' : 'attempts'} left.` : '';
      return { kind: 'wrong', message: `That code did not work.${tail}` };
    }
    return { kind: 'error', message: messageFor(response.status, body.code) };
  } catch {
    return { kind: 'error', message: UNAVAILABLE };
  }
}
