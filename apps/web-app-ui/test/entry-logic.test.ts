import { describe, expect, it, vi } from 'vitest';
import { afterSession, checkNewPassword, countdown, defaultFactor, safeNext } from '../src/entry/flow';
import {
  proveCode,
  proveFactor,
  sendFactorCode,
  signIn,
  type MfaChallenge,
} from '../src/entry/session-calls';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A fetch double that answers once and records what it was asked. */
const answering = (response: Response | Error) => {
  const calls: { url: string; body: unknown }[] = [];
  const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
};

const session = { accessToken: 'at-1', scope: 'CONSUMER', expiresIn: 600, expiresAt: 4_000_000_000_000 };
const challengeId = '9b2f4c1e-7a3d-4e5b-8c6f-1d0a2b3c4e5f';

describe('signIn', () => {
  it('goes to the app’s own route handler, never the backend', async () => {
    const { fetch, calls } = answering(json({ ...session, nextStep: 'DONE' }));
    const outcome = await signIn(' 0802 341 5567 ', 'pw', fetch);
    expect(calls[0]).toEqual({
      url: '/api/auth/login',
      body: { identifier: '0802 341 5567', password: 'pw' },
    });
    expect(outcome).toEqual({
      kind: 'session',
      session: { accessToken: 'at-1', scope: 'CONSUMER', expiresAt: 4_000_000_000_000 },
      nextStep: 'DONE',
    });
  });

  it('reads one rejection for a wrong password and no such account', async () => {
    const { fetch } = answering(json({ code: 'INVALID_CREDENTIALS' }, 401));
    expect(await signIn('x', 'y', fetch)).toEqual({ kind: 'rejected' });
  });

  it('carries the challenge of a sign-in that owes a second factor', async () => {
    const challenge = {
      mfaRequired: true,
      mfaToken: 'cid.secret',
      expiresAt: 1,
      factors: [{ id: 'f1', type: 'TOTP', hint: null, isDefault: true }],
    };
    const { fetch } = answering(json(challenge));
    expect(await signIn('x', 'y', fetch)).toMatchObject({
      kind: 'mfa',
      challenge: { mfaToken: 'cid.secret' },
    });
  });

  it('shows a suspended account its support reference, never the reason', async () => {
    const { fetch } = answering(
      json(
        { code: 'FORBIDDEN', account: { noticeKey: 'ACCOUNT_SUSPENDED', supportReference: 'KMT-U-1' } },
        403,
      ),
    );
    expect(await signIn('x', 'y', fetch)).toEqual({
      kind: 'notice',
      notice: { noticeKey: 'ACCOUNT_SUSPENDED', supportReference: 'KMT-U-1' },
    });
  });

  it('tells a staff account it cannot sign in here', async () => {
    const { fetch } = answering(json({ code: 'WRONG_SCOPE' }, 403));
    expect(await signIn('x', 'y', fetch)).toEqual({ kind: 'wrong-scope' });
  });

  it('says how long to wait when it was told', async () => {
    const { fetch } = answering(json({ code: 'RATE_LIMITED' }, 429, { 'retry-after': '42' }));
    expect(await signIn('x', 'y', fetch)).toEqual({ kind: 'limited', wait: 42 });
  });

  it('does not blame the credentials when the phone is offline', async () => {
    const { fetch } = answering(new TypeError('Failed to fetch'));
    expect(await signIn('x', 'y', fetch)).toEqual({ kind: 'unavailable' });
  });

  it('refuses a session of another scope rather than adopting it', async () => {
    const { fetch } = answering(json({ ...session, scope: 'STAFF' }));
    expect(await signIn('x', 'y', fetch)).toEqual({ kind: 'unavailable' });
  });
});

describe('the second factor', () => {
  const challenge: MfaChallenge = {
    mfaToken: 'cid.secret',
    expiresAt: 1,
    factors: [
      { id: 'p1', type: 'PASSKEY', hint: null, isDefault: true },
      { id: 's1', type: 'SMS_OTP', hint: '•••5567', isDefault: false },
    ],
  };

  it('skips a passkey, which this screen cannot run, for the next usable factor', () => {
    expect(defaultFactor(challenge.factors)?.id).toBe('s1');
  });

  it('reads a wrong code as a wrong code, because the password is already proved', async () => {
    const { fetch } = answering(json({ code: 'INVALID_CREDENTIALS', attemptsRemaining: 3 }, 401));
    expect(await proveFactor(challenge, challenge.factors[1]!, '123456', fetch)).toEqual({
      kind: 'wrong-code',
    });
  });

  it('asks for the SMS and says where it went', async () => {
    const { fetch, calls } = answering(
      json({ kind: 'CODE', maskedDestination: '+23480•••5567', delivered: true }),
    );
    expect(await sendFactorCode(challenge, challenge.factors[1]!, fetch)).toEqual({
      kind: 'sent',
      destination: '+23480•••5567',
      delivered: true,
    });
    expect(calls[0]?.url).toBe('/api/auth/mfa-challenge');
  });
});

describe('proveCode', () => {
  it('opens the session a verified phone signs in to, with the step it owes', async () => {
    const { fetch, calls } = answering(json({ verified: true, nextStep: 'SET_PASSWORD', ...session }));
    expect(await proveCode(challengeId, '482390', fetch)).toMatchObject({
      kind: 'session',
      nextStep: 'SET_PASSWORD',
    });
    expect(calls[0]).toEqual({ url: '/api/auth/verify', body: { challengeId, code: '482390' } });
  });

  it('hands back a reset token, and no session, for a reset code', async () => {
    const { fetch } = answering(
      json({ verified: true, nextStep: 'SET_PASSWORD', resetToken: 'cid.secret', expiresAt: 1 }),
    );
    expect(await proveCode(challengeId, '482390', fetch)).toEqual({
      kind: 'reset',
      resetToken: 'cid.secret',
    });
  });

  it('counts the attempts left for screen E3b', async () => {
    const { fetch } = answering(json({ code: 'OTP_INVALID', attemptsRemaining: 2 }, 422));
    expect(await proveCode(challengeId, '481902', fetch)).toEqual({ kind: 'wrong', attemptsRemaining: 2 });
  });

  it('asks for a fresh code once there are none left, without saying which mistake it was', async () => {
    const { fetch } = answering(json({ code: 'OTP_INVALID' }, 422));
    expect(await proveCode(challengeId, '481902', fetch)).toEqual({ kind: 'spent' });
  });

  it('says another account verified the number first', async () => {
    const { fetch } = answering(json({ code: 'CONFLICT' }, 409));
    expect(await proveCode(challengeId, '481902', fetch)).toEqual({ kind: 'taken' });
  });
});

describe('where a fresh session goes', () => {
  it('takes the Terms first, then a first password, keeping where the person was going', () => {
    expect(afterSession('ACCEPT_TERMS', '/trades')).toBe('/terms-updated?next=%2Ftrades');
    expect(afterSession('SET_PASSWORD', undefined)).toBe('/set-password');
  });

  it('sends onboarding steps that are not built yet where the person was going', () => {
    expect(afterSession('CHOOSE_USERNAME', '/trades')).toBe('/trades');
    expect(afterSession('DONE', undefined)).toBe('/');
  });
});

describe('safeNext', () => {
  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', 'trades'])('drops %s', (value) => {
    expect(safeNext(value)).toBeUndefined();
  });

  it('drops the way in itself, which would be a loop', () => {
    expect(safeNext('/login?next=%2Ftrades')).toBeUndefined();
    expect(safeNext('/signup/terms')).toBeUndefined();
  });

  it('keeps a plain path on this host', () => {
    expect(safeNext('/trades?tab=open')).toBe('/trades?tab=open');
    expect(safeNext('/terms-updated')).toBe('/terms-updated');
  });
});

describe('the small things', () => {
  it('checks a new password the way the platform will', () => {
    expect(checkNewPassword('short', 'short')).toMatch(/10 characters/);
    expect(checkNewPassword('long enough phrase', 'long enough phrasf')).toMatch(/don't match/);
    expect(checkNewPassword('long enough phrase', 'long enough phrase')).toBeNull();
  });

  it('counts down the way the reference writes it', () => {
    expect(countdown(24)).toBe('0:24');
    expect(countdown(65)).toBe('1:05');
  });
});
