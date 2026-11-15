import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client.js';
import {
  MERCHANT_APPLICATION_STATUSES,
  MERCHANT_DOCUMENT_TYPES,
  MERCHANT_FORM_FIELDS,
  approveMerchantApplication,
  assignMerchantApplication,
  countMerchantApplications,
  getMerchantApplication,
  getMyMerchantApplication,
  listMerchantApplications,
  rejectMerchantApplication,
  requestMerchantChanges,
  resubmitMerchantApplication,
  saveMerchantDraft,
  submitMerchantApplication,
} from '../src/merchant.js';

const id = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const item = {
  applicationId: id(1),
  caseId: id(2),
  caseNumber: 'C-002841',
  caseState: 'OPEN',
  priority: 'NORMAL',
  slaStartedAt: '2026-11-14T08:00:00.000Z',
  slaDueAt: '2026-11-16T08:00:00.000Z',
  ownerUserId: null,
  applicantUserId: id(3),
  applicantPublicId: 'KMT-U-7F3K9Q',
  businessName: 'Techedge Nigeria Ltd',
  businessType: 'REGISTERED_BUSINESS',
  categories: ['PHONES'],
  status: 'SUBMITTED',
  submissionCount: 1,
  submittedAt: '2026-11-14T08:00:00.000Z',
};

const detail = {
  ...item,
  form: {
    businessName: 'Techedge Nigeria Ltd',
    businessType: 'REGISTERED_BUSINESS',
    addressLine: '12 Allen Avenue',
    stateName: 'Lagos',
    cityName: 'Ikeja',
    categories: ['PHONES'],
    cacRcNumber: '123456',
  },
  documents: [
    {
      docType: 'CAC_CERTIFICATE',
      label: 'CAC certificate',
      fileId: id(5),
      contentType: 'application/pdf',
      url: 'https://files.test/x',
      expiresAt: '2026-11-14T08:05:00.000Z',
    },
  ],
  evidence: {
    identityLevel: 2,
    cacLookup: {
      state: 'VERIFIED',
      registeredBusinessName: 'TECHEDGE NIGERIA LIMITED',
      rcMatchesApplication: true,
    },
    documents: { required: ['CAC_CERTIFICATE'], present: ['CAC_CERTIFICATE'], missing: [], complete: true },
    bankNameMatch: { state: 'EXACT', bankName: 'Access Bank', accountNumberMasked: '******5567' },
  },
  advisory: { label: 'AI-suggested — not a decision', source: 'RULES_V1', suggestion: 's', rationale: ['r'] },
  applicant: {
    userId: id(3),
    publicId: 'KMT-U-7F3K9Q',
    username: null,
    verificationLevel: 2,
    verificationLevelName: 'IDENTITY_VERIFIED',
    memberSince: '2026-01-01T00:00:00.000Z',
    trades: { total: 4, completed: 3 },
  },
  changesRequested: [],
  history: [],
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

describe('the merchant certification endpoints', () => {
  it('are scoped and permission-bearing the way the backend mounts them', () => {
    expect(listMerchantApplications).toMatchObject({
      method: 'get',
      path: '/admin/merchant/applications',
      scope: 'STAFF',
      paginated: 'page',
    });
    expect(countMerchantApplications).toMatchObject({
      path: '/admin/merchant/applications/count',
      scope: 'STAFF',
    });
    expect(getMerchantApplication).toMatchObject({
      path: '/admin/merchant/applications/:id',
      scope: 'STAFF',
    });
    for (const [e, action] of [
      [assignMerchantApplication, 'assign'],
      [approveMerchantApplication, 'approve'],
      [requestMerchantChanges, 'request-changes'],
      [rejectMerchantApplication, 'reject'],
    ] as const) {
      expect(e).toMatchObject({ method: 'post', scope: 'STAFF', retryable: true });
      expect(e.path).toBe(`/admin/merchant/applications/:id/${action}`);
    }
    expect(getMyMerchantApplication).toMatchObject({ path: '/merchant/applications/me', scope: 'CONSUMER' });
    expect(saveMerchantDraft).toMatchObject({ method: 'put', scope: 'CONSUMER', retryable: true });
    expect(submitMerchantApplication.path).toBe('/merchant/applications/:id/submit');
    expect(resubmitMerchantApplication.path).toBe('/merchant/applications/:id/resubmit');
  });

  it('asks for a numbered page of the open queue, filtered, and parses it', async () => {
    const { client, urls } = clientFor({ items: [item], page: 1, limit: 50, total: 1 });
    const page = await client.call(listMerchantApplications, {
      query: { show: 'open', status: 'SUBMITTED', category: 'PHONES', page: 2, limit: 50 },
    });
    expect(urls[0]).toContain('/admin/merchant/applications?');
    expect(urls[0]).toContain('status=SUBMITTED');
    expect(urls[0]).toContain('category=PHONES');
    expect(page.items[0]?.caseNumber).toBe('C-002841');
  });

  it('parses the detail and refuses an advisory with any label but the fixed one', async () => {
    const { client } = clientFor(detail);
    const parsed = await client.call(getMerchantApplication, { params: { id: id(1) } });
    expect(parsed.evidence.bankNameMatch.state).toBe('EXACT');
    expect(parsed.applicant.trades).toEqual({ total: 4, completed: 3 });
    expect(
      getMerchantApplication.schema.response.safeParse({
        ...detail,
        advisory: { ...detail.advisory, label: 'Decision' },
      }).success,
    ).toBe(false);
  });

  it('requires a policy citation on every decision, and names at least one change to request', () => {
    for (const e of [approveMerchantApplication, rejectMerchantApplication]) {
      const body = e.schema.body as NonNullable<typeof e.schema.body>;
      expect(body.safeParse({ reason: 'Checked', policyCitation: 'MER-1' }).success).toBe(true);
      expect(body.safeParse({ reason: 'Checked' }).success).toBe(false);
      expect(body.safeParse({ reason: 'Checked', policyCitation: '  ' }).success).toBe(false);
      expect(body.safeParse({ reason: 'Checked', policyCitation: 'MER-1', advisory: 'x' }).success).toBe(
        false,
      );
    }
    const changes = requestMerchantChanges.schema.body as NonNullable<
      typeof requestMerchantChanges.schema.body
    >;
    const ok = {
      reason: 'r',
      policyCitation: 'MER-1',
      requested: [{ kind: 'DOCUMENT', key: 'CAC_CERTIFICATE' }],
    };
    expect(changes.safeParse(ok).success).toBe(true);
    expect(changes.safeParse({ ...ok, requested: [] }).success).toBe(false);
    expect(changes.safeParse({ ...ok, requested: [{ kind: 'PERSON', key: 'x' }] }).success).toBe(false);
  });

  it('sends a decision with its citation', async () => {
    const { client, bodies, urls } = clientFor({
      applicationId: id(1),
      status: 'APPROVED',
      storefrontSlug: 'techedge',
    });
    const out = await client.call(approveMerchantApplication, {
      params: { id: id(1) },
      body: { reason: 'Verified', policyCitation: 'Design §6.3' },
    });
    expect(out.storefrontSlug).toBe('techedge');
    expect(urls[0]).toContain(`/admin/merchant/applications/${id(1)}/approve`);
    expect(String(bodies[0])).toContain('Design §6.3');
  });

  it('keeps its vocabulary in step with the backend: statuses, documents and form fields', () => {
    const read = (path: string) =>
      readFileSync(
        new URL(`../../../apps/backend-api/src/modules/merchant/domain/${path}`, import.meta.url),
        'utf8',
      );
    const list = (source: string, name: string) => {
      const block = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`).exec(source)?.[1] ?? '';
      return [...block.matchAll(/'([A-Za-z_]+)'/g)].map((match) => match[1]);
    };
    expect([...MERCHANT_APPLICATION_STATUSES]).toEqual(
      list(read('status.ts'), 'MERCHANT_APPLICATION_STATUSES'),
    );
    expect([...MERCHANT_DOCUMENT_TYPES]).toEqual(list(read('application.ts'), 'DOCUMENT_TYPES'));
    expect([...MERCHANT_FORM_FIELDS]).toEqual(list(read('application.ts'), 'FORM_FIELDS'));
  });
});
