import { describe, expect, it, vi } from 'vitest';
import {
  defaultFactor,
  safeNext,
  sendCode,
  submitCode,
  submitPassword,
  usableFactors,
  type Factor,
} from '../src/auth/sign-in';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const factor = (type: Factor['type'], isDefault = false): Factor => ({
  id: `0190b0a0-0000-7000-8000-${type.length.toString().padStart(12, '0')}`,
  type,
  hint: null,
  isDefault,
});

const challenge = {
  mfaRequired: true,
  mfaToken: 'cid.secret',
  expiresAt: 4_000_000_000_000,
  factors: [factor('TOTP', true)],
};

const stub = (...replies: Response[]) => {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
    calls.push({
      url,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    return Promise.resolve(replies.shift() ?? json({}, 500));
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
};

describe('safeNext', () => {
  it('keeps a path on this host', () => {
    expect(safeNext('/disputes?status=open')).toBe('/disputes?status=open');
  });

  it.each(['//evil.com/x', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '', undefined, null])(
    'drops %s',
    (value) => {
      expect(safeNext(value)).toBeUndefined();
    },
  );
});

describe('the factors', () => {
  it('leaves out a passkey, which this screen cannot present', () => {
    expect(usableFactors([factor('PASSKEY'), factor('TOTP')]).map((f) => f.type)).toEqual(['TOTP']);
  });

  it('starts on the default factor, else the first usable one', () => {
    expect(defaultFactor([factor('RECOVERY_CODE'), factor('TOTP', true)])?.type).toBe('TOTP');
    expect(defaultFactor([factor('PASSKEY', true), factor('SMS_OTP')])?.type).toBe('SMS_OTP');
    expect(defaultFactor([factor('PASSKEY')])).toBeUndefined();
  });
});

describe('submitPassword', () => {
  it('posts to the console route and returns the challenge', async () => {
    const { fetchImpl, calls } = stub(json(challenge));
    const result = await submitPassword({ identifier: 'amina@komtru.com', password: 'pw' }, fetchImpl);
    expect(calls[0]).toEqual({
      url: '/api/auth/login',
      body: { identifier: 'amina@komtru.com', password: 'pw' },
    });
    expect(result).toMatchObject({ kind: 'challenge', challenge: { mfaToken: 'cid.secret' } });
  });

  it('says a wrong password is a wrong password, in one voice', async () => {
    const { fetchImpl } = stub(json({ code: 'INVALID_CREDENTIALS' }, 401));
    expect(await submitPassword({ identifier: 'a', password: 'b' }, fetchImpl)).toEqual({
      kind: 'error',
      message: 'That sign-in did not match. Check it and try again.',
    });
  });

  it('refuses a session answer it was never meant to get', async () => {
    const { fetchImpl } = stub(json({ accessToken: 'x', scope: 'STAFF' }));
    expect((await submitPassword({ identifier: 'a', password: 'b' }, fetchImpl)).kind).toBe('error');
  });

  it('survives the network failing', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    expect(await submitPassword({ identifier: 'a', password: 'b' }, fetchImpl)).toMatchObject({
      kind: 'error',
    });
  });

  it('reports a throttle as a throttle', async () => {
    const { fetchImpl } = stub(json({ code: 'RATE_LIMITED' }, 429));
    expect(await submitPassword({ identifier: 'a', password: 'b' }, fetchImpl)).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('Too many') as unknown,
    });
  });
});

describe('sendCode', () => {
  it('asks for the code for an SMS factor', async () => {
    const { fetchImpl, calls } = stub(
      json({ kind: 'CODE', challengeId: null, maskedDestination: '+23480•••5567', delivered: true }),
    );
    const sms = factor('SMS_OTP');
    const result = await sendCode({ mfaToken: 'cid.secret', factorId: sms.id }, fetchImpl);
    expect(calls[0]?.url).toBe('/api/auth/mfa-challenge');
    expect(result).toEqual({ kind: 'sent', destination: '+23480•••5567' });
  });

  it('says so when no code went out', async () => {
    const { fetchImpl } = stub(
      json({ kind: 'CODE', challengeId: null, maskedDestination: null, delivered: false }),
    );
    expect((await sendCode({ mfaToken: 't', factorId: 'f' }, fetchImpl)).kind).toBe('error');
  });
});

describe('submitCode', () => {
  const input = { mfaToken: 'cid.secret', factorId: 'f', code: '123456' };

  it('opens the session on the right code', async () => {
    const { fetchImpl, calls } = stub(
      json({ accessToken: 'at', scope: 'STAFF', expiresIn: 600, expiresAt: 1 }),
    );
    expect(await submitCode(input, fetchImpl)).toEqual({ kind: 'ok' });
    expect(calls[0]).toEqual({ url: '/api/auth/mfa', body: input });
  });

  it('keeps the attempts left on a wrong code', async () => {
    const { fetchImpl } = stub(json({ code: 'INVALID_CREDENTIALS', attemptsRemaining: 3 }, 401));
    expect(await submitCode(input, fetchImpl)).toEqual({
      kind: 'wrong',
      message: 'That code did not work. 3 attempts left.',
    });
  });

  it('tells a wrong-scope account it cannot sign in here', async () => {
    const { fetchImpl } = stub(json({ code: 'WRONG_SCOPE' }, 403));
    expect(await submitCode(input, fetchImpl)).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('cannot sign in') as unknown,
    });
  });

  it('reports a rejected code as a wrong one, never as a signed-in person', async () => {
    const { fetchImpl } = stub(json({ code: 'INVALID_CREDENTIALS' }, 401));
    expect((await submitCode(input, fetchImpl)).kind).toBe('wrong');
  });
});
