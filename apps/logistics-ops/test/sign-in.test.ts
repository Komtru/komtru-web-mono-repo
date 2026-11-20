// T-160's sign-in decisions over a stubbed `fetch`: which outcome each platform answer becomes, and
// that "not attached to a company" is never the wrong-password message.
import { describe, expect, it, vi } from 'vitest';
import { destinationFor } from '../src/auth/park';
import { messageFor, safeNext, submitCode, submitPassword } from '../src/auth/sign-in';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchReturning = (response: Response) =>
  vi.fn(() => Promise.resolve(response)) as unknown as typeof fetch;
const credentials = { identifier: 'ada@swift.ng', password: 'correct horse' };

describe('submitPassword', () => {
  it('calls the app’s own login handler, never the backend', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(json({ accessToken: 't', scope: 'LOGISTICS' })));
    await submitPassword(credentials, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));
  });

  it('opens a session for a LOGISTICS answer', async () => {
    expect(
      await submitPassword(credentials, fetchReturning(json({ accessToken: 't', scope: 'LOGISTICS' }))),
    ).toEqual({
      kind: 'session',
    });
  });

  it('turns 403 NO_LOGISTICS_ACCESS into its own state, distinct from invalid credentials', async () => {
    const noAccess = await submitPassword(
      credentials,
      fetchReturning(json({ status: 403, code: 'NO_LOGISTICS_ACCESS', title: 'x' }, 403)),
    );
    expect(noAccess).toEqual({ kind: 'no-access' });
    const wrong = await submitPassword(
      credentials,
      fetchReturning(json({ status: 401, code: 'INVALID_CREDENTIALS', title: 'x' }, 401)),
    );
    expect(wrong).toEqual({ kind: 'error', message: messageFor(401, 'INVALID_CREDENTIALS') });
  });

  it('moves to a second factor when the account has one', async () => {
    const result = await submitPassword(
      credentials,
      fetchReturning(json({ mfaRequired: true, mfaToken: 'c.s', expiresAt: 4_000_000_000_000, factors: [] })),
    );
    expect(result.kind).toBe('challenge');
  });

  it('refuses a session of another scope, and survives a network failure', async () => {
    expect((await submitPassword(credentials, fetchReturning(json({ scope: 'CONSUMER' })))).kind).toBe(
      'error',
    );
    const offline = vi.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    expect((await submitPassword(credentials, offline)).kind).toBe('error');
  });
});

describe('submitCode', () => {
  it('reports attempts left on a wrong code, and no-access when the membership went away', async () => {
    const wrong = await submitCode(
      { mfaToken: 'c.s', factorId: 'f', code: '000000' },
      fetchReturning(json({ code: 'INVALID_CREDENTIALS', attemptsRemaining: 2 }, 401)),
    );
    expect(wrong).toEqual({ kind: 'wrong', message: 'That code did not work. 2 attempts left.' });
    const gone = await submitCode(
      { mfaToken: 'c.s', factorId: 'f', code: '123456' },
      fetchReturning(json({ code: 'NO_LOGISTICS_ACCESS' }, 403)),
    );
    expect(gone).toEqual({ kind: 'no-access' });
  });
});

describe('where a signed-in person goes', () => {
  const company = (isDefault: boolean) => ({
    company: { id: 'c', name: 'x', status: 'ENABLED' as const, isDefault, createdAt: '' },
  });

  it('sends a Park Agent to the Park app', () => {
    expect(destinationFor(company(true), '/team', '/team', 'https://park.komtru.com')).toEqual({
      kind: 'park',
      url: 'https://park.komtru.com',
    });
    expect(destinationFor(company(true), undefined, '/team', undefined)).toMatchObject({ kind: 'park' });
  });

  it('keeps a courier POC in the portal, at a safe next path or home', () => {
    expect(destinationFor(company(false), '/team?x=1', '/team', undefined)).toEqual({
      kind: 'portal',
      path: '/team?x=1',
    });
    expect(destinationFor(company(false), '//evil.com', '/team', undefined)).toEqual({
      kind: 'portal',
      path: '/team',
    });
    expect(safeNext('/\\evil.com')).toBeUndefined();
  });
});
