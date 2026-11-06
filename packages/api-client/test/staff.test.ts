import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client.js';
import { authRoutePaths } from '../src/auth/session.js';
import {
  acceptStaffInvitation,
  activateTotp,
  enrolTotp,
  getStaffMe,
  startStaffAcceptance,
} from '../src/staff.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const id = '0190b0a0-0000-7000-8000-000000000001';

const clientFor = (body: unknown) => {
  const fetch = vi.fn(() => Promise.resolve(json(body)));
  return {
    client: createApiClient({
      baseUrl: 'https://api.test/v1',
      fetch: fetch,
    }),
    fetch,
  };
};

describe('the staff endpoints', () => {
  it('declare the scope the backend routes carry', () => {
    expect(getStaffMe).toMatchObject({ method: 'get', path: '/admin/me', scope: 'STAFF' });
    // Acceptance is a CONSUMER call: the signed-in account that owns the invited address makes it.
    for (const endpoint of [startStaffAcceptance, acceptStaffInvitation, enrolTotp, activateTotp]) {
      expect(endpoint.method).toBe('post');
      expect(endpoint.scope).toBe('CONSUMER');
      // Each response carries a one-time secret, so none of them may be keyed and replayed.
      expect(endpoint.retryable).toBeFalsy();
    }
  });

  it('read the signed-in staff member', async () => {
    const { client } = clientFor({
      user: { id, publicId: 'U1', displayName: 'Amina Yusuf', username: null },
      roles: [{ code: 'KYC_ANALYST', name: 'KYC analyst' }],
      permissions: ['verification.view', 'verification.review'],
    });
    const me = await client.call(getStaffMe, {});
    expect(me.roles[0]?.code).toBe('KYC_ANALYST');
    expect(me.permissions).toContain('verification.view');
  });

  it('refuse an answer that is not a staff member', async () => {
    const { client } = clientFor({ user: { id } });
    await expect(client.call(getStaffMe, {})).rejects.toBeDefined();
  });

  it('send the token and the code to accept, and read both outcomes', async () => {
    const granted = clientFor({ status: 'GRANTED', roleCode: 'KYC_ANALYST', assignmentId: id });
    const body = { token: 't'.repeat(24), challengeId: id, code: '123456' };
    expect(await granted.client.call(acceptStaffInvitation, { body })).toMatchObject({ status: 'GRANTED' });
    expect(
      JSON.parse((granted.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string),
    ).toEqual(body);

    const pending = clientFor({ status: 'PENDING_APPROVAL', roleCode: 'SUPER_ADMIN', approvalId: id });
    expect(await pending.client.call(acceptStaffInvitation, { body })).toMatchObject({
      status: 'PENDING_APPROVAL',
    });
  });

  it('read the challenge a start sends', async () => {
    const { client } = clientFor({ challengeId: id, expiresAt: '2026-11-07T10:00:00.000Z' });
    const started = await client.call(startStaffAcceptance, { body: { token: 't'.repeat(24) } });
    expect(started.challengeId).toBe(id);
  });
});

describe('authRoutePaths', () => {
  it('names the second-step handlers beside the first', () => {
    expect(authRoutePaths()).toMatchObject({
      login: '/api/auth/login',
      mfa: '/api/auth/mfa',
      mfaChallenge: '/api/auth/mfa-challenge',
    });
  });
});
