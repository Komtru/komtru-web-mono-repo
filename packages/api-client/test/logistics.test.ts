// The logistics contracts (F-065) against the backend's route table: same method, path and scope, and
// a retryable flag exactly where the route takes an Idempotency-Key. No portal body accepts a company.
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client.js';
import {
  cancelLogisticsInvitation,
  getLogisticsMe,
  inviteLogisticsMember,
  listLogisticsCompanies,
  listLogisticsCompanyMembers,
  listLogisticsInvitations,
  listLogisticsMembers,
  onboardLogisticsCompany,
  updateLogisticsCompany,
  updateLogisticsMember,
} from '../src/logistics.js';

const id = '0190b0a0-0000-7000-8000-000000000001';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the logistics endpoints', () => {
  it('declare the method, path and scope the backend routes carry', () => {
    const table = [
      getLogisticsMe,
      listLogisticsMembers,
      inviteLogisticsMember,
      updateLogisticsMember,
      listLogisticsInvitations,
      cancelLogisticsInvitation,
      onboardLogisticsCompany,
      listLogisticsCompanies,
      updateLogisticsCompany,
      listLogisticsCompanyMembers,
    ].map((e) => `${e.method.toUpperCase()} ${e.path} ${e.scope}${e.retryable ? ' retryable' : ''}`);
    expect(table).toEqual([
      'GET /logistics/me LOGISTICS',
      'GET /logistics/members LOGISTICS',
      'POST /logistics/members LOGISTICS retryable',
      'PATCH /logistics/members/:id LOGISTICS',
      'GET /logistics/invitations LOGISTICS',
      'DELETE /logistics/invitations/:id LOGISTICS',
      'POST /admin/logistics/companies STAFF retryable',
      'GET /admin/logistics/companies STAFF',
      'PATCH /admin/logistics/companies/:id STAFF',
      'GET /admin/logistics/companies/:id/members STAFF',
    ]);
  });

  it('refuses a company id in a portal body', () => {
    const body = inviteLogisticsMember.schema.body!;
    expect(body.safeParse({ email: 'a@example.com', role: 'OPERATOR' }).success).toBe(true);
    expect(body.safeParse({ email: 'a@example.com', role: 'OPERATOR', companyId: id }).success).toBe(false);
  });

  it('sends an invite with an Idempotency-Key and reads both outcomes', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        json(
          {
            outcome: 'PENDING',
            invitation: {
              id,
              role: 'OPERATOR',
              channel: 'EMAIL',
              contactMasked: 'a•••@example.com',
              status: 'PENDING',
              invitedAt: '2026-11-20T00:00:00.000Z',
              expiresAt: '2026-11-27T00:00:00.000Z',
            },
          },
          201,
        ),
      ),
    );
    const client = createApiClient({ baseUrl: 'https://api.test/v1', fetch });
    const result = await client.call(inviteLogisticsMember, {
      body: { email: 'a@example.com', role: 'OPERATOR' },
    });
    expect(result.outcome).toBe('PENDING');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/logistics/members');
    expect(new Headers(init.headers).get('Idempotency-Key')).toBeTruthy();
  });
});
