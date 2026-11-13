import { describe, expect, it } from 'vitest';
import {
  clearedCookies,
  createSessionSealer,
  REFRESH_COOKIE,
  requireSessionSecret,
  secureCookieFor,
  SESSION_COOKIE,
  sessionCookies,
  subjectDigest,
  type SessionHint,
} from '../src/session.js';

const sealer = createSessionSealer('a'.repeat(32));
const hint: SessionHint = { scope: 'STAFF', expiresAt: 2_000_000_000_000 };

const b64url = (value: string): string =>
  btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (value: string): string =>
  atob(
    value
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '='),
  );

/** The sealer's own wire format, rebuilt here so a test can sign a payload the sealer never would. */
const signWith = async (secret: string, payload: unknown): Promise<string> => {
  const body = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v1.${body}`));
  return `v1.${body}.${b64url(String.fromCharCode(...new Uint8Array(mac)))}`;
};

describe('the sealed session hint', () => {
  it('opens what it sealed', async () => {
    expect(await sealer.open(await sealer.seal(hint), 1_000)).toEqual(hint);
  });

  it('refuses a hint sealed with another secret', async () => {
    const other = createSessionSealer('b'.repeat(32));
    expect(await sealer.open(await other.seal(hint), 1_000)).toBeNull();
  });

  it('refuses a hint whose scope was edited', async () => {
    const sealed = await sealer.seal({ scope: 'CONSUMER', expiresAt: hint.expiresAt });
    const [version, payload, signature] = sealed.split('.');
    const forged = JSON.parse(fromB64url(payload!)) as { s: string };
    forged.s = 'STAFF';
    const tampered = [version, b64url(JSON.stringify(forged)), signature].join('.');
    expect(await sealer.open(tampered, 1_000)).toBeNull();
  });

  it.each([undefined, '', 'nonsense', 'v1.only-two', 'v2.aaa.bbb', 'v1..', 'v1.!!!.!!!'])(
    'returns null rather than throwing for %j',
    async (token) => {
      await expect(sealer.open(token, 1_000)).resolves.toBeNull();
    },
  );

  it('refuses a hint carrying a scope that is not a session scope', async () => {
    // Signed with the real secret, so only the scope check can reject it: a valid signature proves
    // the payload is ours, never that what it says is a thing.
    const resealed = await signWith('a'.repeat(32), { s: 'ROOT', e: 2_000_000_000 });
    expect(await sealer.open(resealed, 1_000)).toBeNull();
  });

  it('refuses a token with anything after the signature, so one session is one string', async () => {
    const sealed = await sealer.seal(hint);
    expect(await sealer.open(`${sealed}.trailing`, 1_000)).toBeNull();
  });

  it('refuses a hint that has expired', async () => {
    expect(await sealer.open(await sealer.seal(hint), hint.expiresAt + 1)).toBeNull();
  });

  it('still accepts a hint in its last millisecond', async () => {
    expect(await sealer.open(await sealer.seal(hint), hint.expiresAt - 1)).toEqual(hint);
  });
});

describe('the facts a session hint carries (F-037)', () => {
  const withFacts: SessionHint = {
    ...hint,
    scope: 'CONSUMER',
    facts: { hasSold: true, certifiedMerchant: false },
  };

  it('opens the facts it sealed', async () => {
    expect(await sealer.open(await sealer.seal(withFacts), 1_000)).toEqual(withFacts);
  });

  it('still opens a hint sealed before facts existed, with none', async () => {
    const opened = await sealer.open(
      await signWith('a'.repeat(32), { s: 'CONSUMER', e: 2_000_000_000 }),
      1_000,
    );
    expect(opened).toEqual({ scope: 'CONSUMER', expiresAt: 2_000_000_000_000 });
    expect(opened).not.toHaveProperty('facts');
  });

  it('refuses a hint whose facts were edited', async () => {
    const sealed = await sealer.seal({ ...withFacts, facts: { hasSold: false } });
    const [version, payload, signature] = sealed.split('.');
    const forged = JSON.parse(fromB64url(payload!)) as { f: Record<string, boolean> };
    forged.f.hasSold = true;
    expect(
      await sealer.open([version, b64url(JSON.stringify(forged)), signature].join('.'), 1_000),
    ).toBeNull();
  });

  it.each([['not an object'], [['hasSold']], [{ hasSold: 'yes' }], [{ 'bad key': true }], [null]])(
    'drops facts it cannot read (%j) rather than guessing, and keeps the session',
    async (f) => {
      const resealed = await signWith('a'.repeat(32), { s: 'CONSUMER', e: 2_000_000_000, f });
      expect(await sealer.open(resealed, 1_000)).toEqual({ scope: 'CONSUMER', expiresAt: 2_000_000_000_000 });
    },
  );
});

describe('sealing facts and a subject (F-037 review)', () => {
  it('throws on facts open would drop: that is a bug in the app asking', async () => {
    for (const facts of [
      { 'bad key': true },
      { hasSold: 'yes' },
      Object.fromEntries([...'abcdefghi'].map((k) => [k, true])),
    ]) {
      await expect(sealer.seal({ ...hint, facts: facts as never })).rejects.toThrow(TypeError);
    }
  });

  it('throws on a subject that is not a digest', async () => {
    await expect(sealer.seal({ ...hint, subject: 'user-1' })).rejects.toThrow(TypeError);
  });

  it('round-trips a subject digest, and digests only a JWT with a sub', async () => {
    const token = `h.${b64url(JSON.stringify({ sub: 'user-1' }))}.s`;
    const subject = await subjectDigest(token);
    expect(subject).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(subject).not.toContain('user');
    expect(await subjectDigest(`h.${b64url(JSON.stringify({ sub: 'user-2' }))}.s`)).not.toBe(subject);
    expect(await sealer.open(await sealer.seal({ ...hint, subject: subject! }), 1_000)).toEqual({
      ...hint,
      subject,
    });
    expect(await subjectDigest('opaque')).toBeUndefined();
    expect(await subjectDigest(`h.${b64url(JSON.stringify({ n: 1 }))}.s`)).toBeUndefined();
  });
});

describe('requireSessionSecret', () => {
  it('refuses a secret too short to be one', () => {
    expect(() => requireSessionSecret({ KOMTRU_SESSION_SECRET: 'short' })).toThrow(/KOMTRU_SESSION_SECRET/);
  });

  it('refuses a missing secret', () => {
    expect(() => requireSessionSecret({})).toThrow(/KOMTRU_SESSION_SECRET/);
  });

  it('returns a secret long enough', () => {
    expect(requireSessionSecret({ KOMTRU_SESSION_SECRET: 'z'.repeat(32) })).toBe('z'.repeat(32));
  });
});

describe('the cookies', () => {
  it('writes both httpOnly, SameSite=Lax and host-only', () => {
    const cookies = sessionCookies({ refreshToken: 'r', sealed: 's', maxAgeSeconds: 60, secure: true });
    expect(cookies.map((cookie) => [cookie.name, cookie.path])).toEqual([
      [REFRESH_COOKIE, '/api/auth'],
      [SESSION_COOKIE, '/'],
    ]);
    for (const cookie of cookies) {
      expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', maxAge: 60 });
      expect(cookie).not.toHaveProperty('domain');
    }
  });

  it('keeps the refresh token on the only path that may read it', () => {
    const [refresh] = sessionCookies({ refreshToken: 'r', sealed: 's', maxAgeSeconds: 60, secure: true });
    expect(refresh?.path).toBe('/api/auth');
    expect(refresh?.value).toBe('r');
  });

  it('clears both with a zero max-age at the same paths', () => {
    expect(clearedCookies(true).map((c) => [c.name, c.value, c.maxAge, c.path])).toEqual([
      [REFRESH_COOKIE, '', 0, '/api/auth'],
      [SESSION_COOKIE, '', 0, '/'],
    ]);
  });

  it.each([
    ['https://app.komtru.com/x', true],
    ['http://localhost:3001/x', false],
    ['http://127.0.0.1:3001/x', false],
    ['http://[::1]:3001/x', false],
    // Plain http on a real host is a misconfiguration: keep Secure so the browser drops the cookie
    // loudly rather than storing a session credential in the clear.
    ['http://app.komtru.com/x', true],
  ])('decides Secure for %s', (href, expected) => {
    expect(secureCookieFor(new URL(href))).toBe(expected);
  });
});
