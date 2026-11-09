// The calls in the way in that can open a session: signing in, the second factor, and proving a
// one-time code. Each goes to this app's own route handlers (`/api/auth/*`), never to the backend,
// so the refresh token stays in an httpOnly cookie and the page only ever holds the access token.
//
// Plain functions over `fetch` that answer with an outcome, not a Response: the screens branch on
// what happened, and this is the part worth testing without rendering anything.
import { authRoutePaths, type AuthSession, type NextStep } from '@komtru/api-client';

const PATHS = authRoutePaths();

export type FactorType = 'TOTP' | 'SMS_OTP' | 'EMAIL_OTP' | 'PASSKEY' | 'RECOVERY_CODE';

export interface Factor {
  id: string;
  type: FactorType;
  hint: string | null;
  isDefault: boolean;
}

export interface MfaChallenge {
  mfaToken: string;
  expiresAt: number;
  factors: Factor[];
}

/** What the platform says about a suspended, locked or closed account (AS1/AS2, T-039). */
export interface AccountNotice {
  noticeKey: 'ACCOUNT_RESTRICTED' | 'ACCOUNT_SUSPENDED' | 'ACCOUNT_LOCKED' | 'ACCOUNT_CLOSED' | null;
  supportReference: string;
}

/** A session the page can hand the API client, and the step the platform says comes next. */
export interface Opened {
  kind: 'session';
  session: AuthSession;
  nextStep: NextStep | undefined;
}

/** Failures every call here shares. */
export type CommonFailure =
  /** Too many attempts; `wait` is seconds when the server said. */
  | { kind: 'limited'; wait: number | undefined }
  /** The phone is offline, or the platform did not answer. Nothing about the credentials. */
  | { kind: 'unavailable' };

export type SignInOutcome =
  | Opened
  | { kind: 'mfa'; challenge: MfaChallenge }
  /** One answer for a wrong password and no such account: the platform says the same (§S3). */
  | { kind: 'rejected' }
  | { kind: 'notice'; notice: AccountNotice }
  /** A real account whose session belongs to another app, such as a staff account. */
  | { kind: 'wrong-scope' }
  | CommonFailure;

export type CodeOutcome =
  | Opened
  /** A password-reset code: proof the SMS arrived and the token the reset needs. Not a sign-in. */
  | { kind: 'reset'; resetToken: string }
  /** Screen E3b: wrong, with attempts left. */
  | { kind: 'wrong'; attemptsRemaining: number }
  /** Spent, expired or unknown: only a fresh code helps. The platform does not say which. */
  | { kind: 'spent' }
  /** Another account verified this number first. */
  | { kind: 'taken' }
  | { kind: 'wrong-scope' }
  | CommonFailure;

export type SendOutcome =
  { kind: 'sent'; destination: string | null; delivered: boolean } | { kind: 'spent' } | CommonFailure;

type Body = Record<string, unknown>;

const readBody = async (response: Response): Promise<Body> => {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null ? (body as Body) : {};
  } catch {
    return {};
  }
};

const post = async (
  path: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<{ status: number; body: Body; retryAfter: string | null } | null> => {
  try {
    const response = await fetchImpl(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: await readBody(response),
      retryAfter: response.headers.get('retry-after'),
    };
  } catch {
    return null;
  }
};

const limited = (retryAfter: string | null): CommonFailure => {
  const wait = retryAfter === null ? Number.NaN : Number(retryAfter);
  return { kind: 'limited', wait: Number.isFinite(wait) && wait > 0 ? wait : undefined };
};

const NEXT_STEPS: ReadonlySet<string> = new Set([
  'ACCEPT_TERMS',
  'VERIFY_EMAIL',
  'VERIFY_PHONE',
  'SET_PASSWORD',
  'CHOOSE_USERNAME',
  'ADD_EMAIL',
  'ADD_PHONE',
  'DONE',
]);

/** The access token and nothing else: the route handler already kept the refresh token. */
const opened = (body: Body): Opened | null => {
  const { accessToken, scope, expiresAt, nextStep } = body;
  if (typeof accessToken !== 'string' || accessToken === '' || scope !== 'CONSUMER') return null;
  return {
    kind: 'session',
    session: {
      accessToken,
      scope,
      ...(typeof expiresAt === 'number' ? { expiresAt } : {}),
    },
    nextStep: typeof nextStep === 'string' && NEXT_STEPS.has(nextStep) ? (nextStep as NextStep) : undefined,
  };
};

const asChallenge = (body: Body): MfaChallenge | null => {
  if (body.mfaRequired !== true || typeof body.mfaToken !== 'string' || !Array.isArray(body.factors)) {
    return null;
  }
  const factors = (body.factors as unknown[]).filter(
    (factor): factor is Factor =>
      typeof factor === 'object' &&
      factor !== null &&
      typeof (factor as Factor).id === 'string' &&
      typeof (factor as Factor).type === 'string',
  );
  return {
    mfaToken: body.mfaToken,
    expiresAt: typeof body.expiresAt === 'number' ? body.expiresAt : 0,
    factors,
  };
};

const asNotice = (body: Body): AccountNotice | null => {
  const account = body.account as Partial<AccountNotice> | undefined;
  if (typeof account !== 'object' || typeof account.supportReference !== 'string') return null;
  return { noticeKey: account.noticeKey ?? null, supportReference: account.supportReference };
};

/** Screen E4. The identifier may be a phone number, an email or a username (M1 §10.1). */
export async function signIn(
  identifier: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SignInOutcome> {
  const result = await post(PATHS.login, { identifier: identifier.trim(), password }, fetchImpl);
  return signInOutcome(result);
}

/** The second step of a sign-in that answered with a challenge. */
export async function proveFactor(
  challenge: MfaChallenge,
  factor: Factor,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SignInOutcome | { kind: 'wrong-code' }> {
  const result = await post(
    PATHS.mfa,
    { mfaToken: challenge.mfaToken, factorId: factor.id, code: code.trim() },
    fetchImpl,
  );
  // A wrong second factor is 401 like a wrong password; here the password is already proved, so it
  // can only mean the code. An expired challenge says the same, and the screen sends them back.
  if (result?.status === 401) return { kind: 'wrong-code' };
  return signInOutcome(result);
}

function signInOutcome(result: Awaited<ReturnType<typeof post>>): SignInOutcome {
  if (result === null) return { kind: 'unavailable' };
  const { status, body } = result;
  if (status === 200) {
    const challenge = asChallenge(body);
    if (challenge !== null) return { kind: 'mfa', challenge };
    return opened(body) ?? { kind: 'unavailable' };
  }
  if (status === 401) return { kind: 'rejected' };
  if (status === 403 && body.code === 'WRONG_SCOPE') return { kind: 'wrong-scope' };
  if (status === 403) {
    const notice = asNotice(body);
    if (notice !== null) return { kind: 'notice', notice };
  }
  if (status === 429) return limited(result.retryAfter);
  return { kind: 'unavailable' };
}

/** Asks the platform to send the code for an SMS or email factor. */
export async function sendFactorCode(
  challenge: MfaChallenge,
  factor: Factor,
  fetchImpl: typeof fetch = fetch,
): Promise<SendOutcome> {
  const result = await post(
    PATHS.mfaChallenge,
    { mfaToken: challenge.mfaToken, factorId: factor.id },
    fetchImpl,
  );
  if (result === null) return { kind: 'unavailable' };
  if (result.status === 200) {
    const { maskedDestination, delivered } = result.body;
    return {
      kind: 'sent',
      destination: typeof maskedDestination === 'string' ? maskedDestination : null,
      delivered: delivered !== false,
    };
  }
  if (result.status === 429) return limited(result.retryAfter);
  if (result.status === 401 || result.status === 422) return { kind: 'spent' };
  return { kind: 'unavailable' };
}

/** Screens E3, E3b and AC3: prove a six-digit code against the challenge it was sent for. */
export async function proveCode(
  challengeId: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CodeOutcome> {
  const result = await post(PATHS.verify, { challengeId, code }, fetchImpl);
  if (result === null) return { kind: 'unavailable' };
  const { status, body } = result;
  if (status === 200) {
    if (typeof body.resetToken === 'string' && body.resetToken !== '') {
      return { kind: 'reset', resetToken: body.resetToken };
    }
    return opened(body) ?? { kind: 'unavailable' };
  }
  if (status === 422 && body.code === 'OTP_INVALID') {
    const left = body.attemptsRemaining;
    return typeof left === 'number' && left > 0
      ? { kind: 'wrong', attemptsRemaining: left }
      : { kind: 'spent' };
  }
  // The route handler's own 422 is a body it could not read, which a six-digit code never is.
  if (status === 409) return { kind: 'taken' };
  if (status === 403 && body.code === 'WRONG_SCOPE') return { kind: 'wrong-scope' };
  if (status === 429) return limited(result.retryAfter);
  return { kind: 'unavailable' };
}

/** Best effort: a sign-out that cannot reach the platform still clears this device's cookies. */
export async function signOut(fetchImpl: typeof fetch = fetch): Promise<void> {
  await post(PATHS.logout, {}, fetchImpl);
}
