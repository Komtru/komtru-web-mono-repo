import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client.js';
import {
  caseQueueCounts,
  decideCase,
  escalateCase,
  getCase,
  getCaseAdvisory,
  listCaseQueue,
  listCaseTrail,
  listCases,
  reassignCase,
  requestCaseEvidence,
  resolveCaseEvidence,
  setCasePriority,
  takeCase,
} from '../src/cases.js';

const id = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const caseRow = {
  id: id(1),
  caseNumber: 2841,
  code: 'C-002841',
  type: 'TRADE_PROPOSAL',
  subjectType: 'TRADE',
  subjectId: 'KMT-90138',
  title: 'Proposal flagged',
  state: 'OPEN',
  priority: 'HIGH',
  ownerUserId: null,
  sla: {
    status: 'AT_RISK',
    dueAt: '2026-11-07T10:00:00.000Z',
    remainingMinutes: 52,
    hours: 24,
    startedAt: '2026-11-06T10:00:00.000Z',
  },
  escalatedAt: null,
  decidedAt: null,
  closedAt: null,
  createdAt: '2026-11-06T10:00:00.000Z',
  updatedAt: '2026-11-06T10:00:00.000Z',
};

describe('the cases endpoints', () => {
  it('are STAFF routes, the reads paginated where the backend paginates', () => {
    for (const e of [listCaseQueue, listCases, listCaseTrail]) expect(e.paginated).toBe('cursor');
    for (const e of [caseQueueCounts, getCase, getCaseAdvisory, listCaseQueue]) {
      expect(e).toMatchObject({ method: 'get', scope: 'STAFF' });
    }
    for (const e of [
      takeCase,
      escalateCase,
      reassignCase,
      setCasePriority,
      requestCaseEvidence,
      resolveCaseEvidence,
      decideCase,
    ]) {
      expect(e).toMatchObject({ method: 'post', scope: 'STAFF', retryable: true });
    }
  });

  it('asks the queue for a view and parses a page of cases', async () => {
    const urls: string[] = [];
    const fetch = vi.fn((input: URL | RequestInfo) => {
      urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(json({ items: [caseRow], nextCursor: null }));
    });
    const client = createApiClient({
      baseUrl: 'https://api.test/v1',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const page = await client.call(listCaseQueue, { query: { view: 'unassigned', type: 'TRADE_PROPOSAL' } });
    expect(urls[0]).toContain('/cases/queue?');
    expect(urls[0]).toContain('view=unassigned');
    expect(urls[0]).toContain('type=TRADE_PROPOSAL');
    expect(page.items[0]?.code).toBe('C-002841');
    expect(page.items[0]?.sla.status).toBe('AT_RISK');
  });

  it('refuses an advisory whose label is not the fixed one', () => {
    const bad = getCaseAdvisory.schema.response.safeParse({
      label: 'Decision',
      source: 'RULES_V1',
      suggestion: 'x',
      rationale: [],
    });
    expect(bad.success).toBe(false);
  });

  it('keeps the decision body to outcome, reason and citation only', () => {
    const body = decideCase.schema.body;
    expect(body.safeParse({ outcome: 'APPROVE', reason: 'r', policyCitation: 'P §1' }).success).toBe(true);
    expect(
      body.safeParse({
        outcome: 'APPROVE',
        reason: 'r',
        policyCitation: 'P §1',
        advisory: { suggestion: 'x' },
      }).success,
    ).toBe(false);
  });
});
