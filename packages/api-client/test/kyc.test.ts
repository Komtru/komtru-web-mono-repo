import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client.js';
import {
  approveApproval,
  assignKycItem,
  decideKycItem,
  getKycItem,
  listApprovals,
  listDuplicateFlags,
  listKycQueue,
  REJECTION_CODES,
  requestVerificationOverride,
  resolveDuplicateFlag,
} from '../src/kyc.js';

const id = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const item = {
  caseId: id(1),
  caseNumber: 'C-002841',
  caseType: 'IDENTITY',
  state: 'OPEN',
  priority: 'HIGH',
  slaDueAt: '2026-11-11T10:00:00.000Z',
  ownerUserId: null,
  requestId: id(2),
  userId: id(3),
  verificationType: 'BVN',
  submittedAt: '2026-11-10T08:00:00.000Z',
  duplicateFlagId: null,
  duplicateFlagStatus: null,
};

const flag = {
  id: id(4),
  identifierType: 'BVN',
  firstUserId: id(5),
  conflictingUserId: id(3),
  requestId: id(2),
  status: 'OPEN',
  detectedAt: '2026-11-10T08:00:00.000Z',
  reviewedBy: null,
  reviewedAt: null,
  resolutionNotes: null,
};

const clientFor = (body: unknown) => {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    bodies.push(init?.body);
    return Promise.resolve(json(body));
  });
  return { client: createApiClient({ baseUrl: 'https://api.test/v1', fetch }), urls, bodies };
};

describe('the KYC review endpoints', () => {
  it('are STAFF routes with the permissions-bearing paths the backend mounts', () => {
    expect(listKycQueue).toMatchObject({
      method: 'get',
      path: '/admin/kyc/queue',
      scope: 'STAFF',
      paginated: 'page',
    });
    expect(getKycItem).toMatchObject({ method: 'get', path: '/admin/kyc/queue/:requestId', scope: 'STAFF' });
    expect(listDuplicateFlags).toMatchObject({
      method: 'get',
      path: '/admin/kyc/duplicate-flags',
      scope: 'STAFF',
      paginated: 'page',
    });
    for (const e of [
      assignKycItem,
      decideKycItem,
      resolveDuplicateFlag,
      requestVerificationOverride,
      approveApproval,
    ]) {
      expect(e).toMatchObject({ method: 'post', scope: 'STAFF', retryable: true });
    }
    expect(assignKycItem.path).toBe('/admin/kyc/queue/:requestId/assign');
    expect(decideKycItem.path).toBe('/admin/kyc/queue/:requestId/decide');
    expect(resolveDuplicateFlag.path).toBe('/admin/kyc/duplicate-flags/:id/resolve');
    expect(requestVerificationOverride.path).toBe('/admin/kyc/overrides');
    expect(approveApproval.path).toBe('/admin/approvals/:approvalId/approve');
  });

  it('asks for a numbered page of the open queue and parses it', async () => {
    const { client, urls } = clientFor({ items: [item], page: 1, limit: 50, total: 1 });
    const page = await client.call(listKycQueue, {
      query: { show: 'open', type: 'KYB', page: 2, limit: 50 },
    });
    expect(urls[0]).toContain('/admin/kyc/queue?');
    expect(urls[0]).toContain('show=open');
    expect(urls[0]).toContain('type=KYB');
    expect(urls[0]).toContain('page=2');
    expect(page.total).toBe(1);
    expect(page.items[0]?.verificationType).toBe('BVN');
  });

  it('carries the advisory with its fixed label and refuses a different one', async () => {
    const advisory = {
      label: 'AI-suggested — not a decision',
      source: 'RULES_V1',
      suggestion: 's',
      rationale: ['r'],
    };
    const { client } = clientFor({ ...item, advisory });
    expect((await client.call(getKycItem, { params: { requestId: id(2) } })).advisory.suggestion).toBe('s');
    const bad = getKycItem.schema.response.safeParse({
      ...item,
      advisory: { ...advisory, label: 'Decision' },
    });
    expect(bad.success).toBe(false);
  });

  it('parses a duplicate flag page', async () => {
    const { client } = clientFor({ items: [flag], page: 1, limit: 50, total: 1 });
    const page = await client.call(listDuplicateFlags, { query: { status: 'OPEN' } });
    expect(page.items[0]?.status).toBe('OPEN');
  });

  it('keeps a decision to the outcome, the analyst words and a citation', () => {
    const body = decideKycItem.schema.body as NonNullable<typeof decideKycItem.schema.body>;
    expect(body.safeParse({ outcome: 'APPROVE', reason: 'Checked the register' }).success).toBe(true);
    expect(body.safeParse({ outcome: 'MAYBE', reason: 'x' }).success).toBe(false);
    expect(body.safeParse({ outcome: 'APPROVE', reason: 'x', advisory: 'y' }).success).toBe(false);
  });

  it('requires an approval id only for the clearing resolution to be meaningful, and keeps the body strict', () => {
    const body = resolveDuplicateFlag.schema.body as NonNullable<typeof resolveDuplicateFlag.schema.body>;
    expect(body.safeParse({ resolution: 'CONFIRMED_DUPLICATE', reason: 'Same BVN' }).success).toBe(true);
    expect(
      body.safeParse({ resolution: 'CLEARED_FALSE_POSITIVE', reason: 'r', approvalId: id(9) }).success,
    ).toBe(true);
    expect(body.safeParse({ resolution: 'REJECTED', reason: 'r' }).success).toBe(false);
  });

  it('asks for a clearance with the flag id and parses the approval', async () => {
    const { client, bodies } = clientFor({ approvalId: id(9), expiresAt: '2026-11-11T10:00:00.000Z' });
    const out = await client.call(requestVerificationOverride, {
      body: { kind: 'CLEAR_DUPLICATE', flagId: id(4), reason: 'Two people, one BVN typo' },
    });
    expect(out.approvalId).toBe(id(9));
    expect(String(bodies[0])).toContain('CLEAR_DUPLICATE');
  });

  it('approves an approval with a reason', async () => {
    const { client } = clientFor({ approvalId: id(9), action: 'VERIFICATION_OVERRIDE', state: 'APPROVED' });
    const out = await client.call(approveApproval, {
      params: { approvalId: id(9) },
      body: { reason: 'Seen it' },
    });
    expect(out.state).toBe('APPROVED');
  });

  it('takes a rejection code, and only one the backend knows', () => {
    const body = decideKycItem.schema.body as NonNullable<typeof decideKycItem.schema.body>;
    expect(
      body.safeParse({ outcome: 'REJECT', reason: 'x', rejectionCode: 'ID_NAME_MISMATCH' }).success,
    ).toBe(true);
    expect(body.safeParse({ outcome: 'REJECT', reason: 'x', rejectionCode: 'because' }).success).toBe(false);
  });

  it('keeps its rejection codes in step with the backend taxonomy', () => {
    const source = readFileSync(
      new URL('../../../apps/backend-api/src/modules/trust/domain/rejection.ts', import.meta.url),
      'utf8',
    );
    const block = /export const REJECTION_CODES = \[([\s\S]*?)\] as const/.exec(source)?.[1] ?? '';
    const backend = [...block.matchAll(/^\s*'([A-Z_]+)',/gm)].map((match) => match[1]);
    expect([...REJECTION_CODES]).toEqual(backend);
  });

  it('lists approvals by state with the reason the platform audits the read under', async () => {
    const row = {
      id: id(9),
      action: 'VERIFICATION_OVERRIDE',
      state: 'PENDING',
      subjectUserId: id(3),
      requestedBy: id(7),
      approvedBy: null,
      reason: 'Two people, one BVN typo',
      requestedAt: '2026-11-10T08:00:00.000Z',
      approvedAt: null,
      executedAt: null,
      expiresAt: '2026-11-11T08:00:00.000Z',
      rejectedAt: null,
    };
    const { client, urls } = clientFor({ items: [row], page: 1, limit: 50, total: 1 });
    const page = await client.call(listApprovals, {
      query: { status: 'PENDING', reason: 'Reviewing a clearance', limit: 50 },
    });
    expect(urls[0]).toContain('/admin/approvals?');
    expect(urls[0]).toContain('status=PENDING');
    expect(urls[0]).toContain('reason=Reviewing');
    expect(page.items[0]?.requestedBy).toBe(id(7));
    expect(listApprovals).toMatchObject({ method: 'get', scope: 'STAFF', paginated: 'page' });
  });
});
