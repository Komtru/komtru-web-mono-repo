// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaseDetail } from '../src/cases/CaseDetail';
import { expectNoAxeViolations } from './axe';
import {
  MANAGE,
  READ,
  ME,
  SHELL_RULES,
  answerWith,
  caseRow,
  id,
  renderWithQuery,
  staff,
} from './support/cases';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@komtru/app-kit/react', () => ({ useApiClient: () => api }));

const CASE_ID = id(1);
const OTHER = id(77);

const detail = (over: Record<string, unknown> = {}) => ({
  ...caseRow(1, {
    type: 'DISPUTE',
    title: 'Item not as described',
    subjectId: 'DIS-88213',
    subjectType: 'DISPUTE',
    state: 'INVESTIGATING',
    ownerUserId: ME,
    priority: 'HIGH',
  }),
  facts: { amountNaira: 195000, sellerAccepted: true, evidenceCount: 2 },
  evidenceRequests: [
    {
      id: id(50),
      caseId: CASE_ID,
      description: 'Photo of the box label',
      fromUserId: null,
      requestedByUserId: ME,
      status: 'OPEN',
      dueAt: null,
      resolvedByUserId: null,
      resolvedAt: null,
      resolutionNote: null,
      createdAt: '2026-11-07T08:00:00.000Z',
    },
  ],
  decisions: [],
  ...over,
});

const SUGGESTION = 'The photos show a different colour. Suggest: return and full refund.';
const advisory = {
  label: 'AI-suggested — not a decision',
  source: 'RULES_V1',
  suggestion: SUGGESTION,
  rationale: ['Seller accepted the mismatch'],
};
const trail = {
  items: [
    {
      id: 2,
      occurredAt: '2026-11-07T09:00:00.000Z',
      type: 'TAKEN',
      actorUserId: ME,
      reason: null,
      metadata: {},
    },
    {
      id: 1,
      occurredAt: '2026-11-07T08:00:00.000Z',
      type: 'REGISTERED',
      actorUserId: null,
      reason: null,
      metadata: {},
    },
  ],
  nextCursor: null,
};

const serve = (permissions: string[], caseDetail = detail(), extra: Record<string, unknown> = {}) =>
  answerWith(api.call, {
    'GET /admin/me': staff(permissions),
    'GET /cases/:id': caseDetail,
    'GET /cases/:id/trail': trail,
    'GET /cases/:id/advisory': advisory,
    ...extra,
  });

const posts = (path: string) => api.call.mock.calls.filter(([endpoint]) => endpoint.path === path);

const fillDecision = (over: Partial<Record<'Outcome' | 'Reason' | 'Policy' | 'Clause', string>> = {}) => {
  const values = {
    Outcome: 'Return and refund',
    Reason: 'Seller accepted the mismatch',
    Policy: 'Dispute Policy',
    Clause: '4.2',
    ...over,
  };
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
};

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

describe('the universal case page', () => {
  it('shows the case, what the owner told the index, the evidence asked for and the Trust Trail', async () => {
    serve(MANAGE);
    const { container } = renderWithQuery(<CaseDetail caseId={CASE_ID} />);

    expect(await screen.findByText('C-000001')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Item not as described' })).toBeTruthy();
    expect(screen.getByText('Investigating')).toBeTruthy();

    const facts = screen.getByRole('region', { name: 'What we know' });
    expect(within(facts).getByText('Amount naira')).toBeTruthy();
    expect(within(facts).getByText('195000')).toBeTruthy();
    expect(within(facts).getByText('Yes')).toBeTruthy();

    expect(screen.getByText('Photo of the box label')).toBeTruthy();
    const trailRegion = await screen.findByRole('region', { name: 'Trust Trail' });
    expect(within(trailRegion).getByText('Registered')).toBeTruthy();
    expect(within(trailRegion).getByText('Taken')).toBeTruthy();

    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('draws the advisory in its own labelled box, apart from the decision actions', async () => {
    serve(MANAGE);
    renderWithQuery(<CaseDetail caseId={CASE_ID} />);
    const box = await screen.findByRole('region', { name: 'AI-suggested — not a decision' });
    expect(within(box).getByText(SUGGESTION)).toBeTruthy();
    expect(within(box).queryAllByRole('button')).toHaveLength(0);
    const actions = screen.getByRole('group', { name: 'Decision actions' });
    expect(actions.contains(box)).toBe(false);
    expect(screen.getByText('a human decides, always')).toBeTruthy();
  });

  it('never fills the decision form from the advisory', async () => {
    serve(MANAGE);
    renderWithQuery(<CaseDetail caseId={CASE_ID} />);
    await screen.findByRole('region', { name: 'AI-suggested — not a decision' });
    for (const label of ['Outcome', 'Reason', 'Policy', 'Clause']) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('');
    }
    expect((screen.getByRole('button', { name: 'Record decision' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('keeps Record decision disabled until outcome, reason, policy and clause are all given', async () => {
    serve(MANAGE);
    renderWithQuery(<CaseDetail caseId={CASE_ID} />);
    await screen.findByRole('group', { name: 'Decision actions' });
    const button = screen.getByRole('button', { name: 'Record decision' }) as HTMLButtonElement;
    for (const missing of ['Outcome', 'Reason', 'Policy', 'Clause'] as const) {
      fillDecision({ [missing]: '' });
      expect(button.disabled).toBe(true);
    }
    fillDecision();
    expect(button.disabled).toBe(false);
  });

  it('records a decision whose body is only outcome, reason and citation', async () => {
    serve(MANAGE, detail(), { 'POST /cases/:id/decisions': { case: caseRow(1), decision: {} } });
    renderWithQuery(<CaseDetail caseId={CASE_ID} />);
    await screen.findByRole('group', { name: 'Decision actions' });
    fillDecision();
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await waitFor(() => expect(posts('/cases/:id/decisions')).toHaveLength(1));

    const [, input] = posts('/cases/:id/decisions')[0]!;
    expect(input).toEqual({
      params: { id: CASE_ID },
      body: {
        outcome: 'Return and refund',
        reason: 'Seller accepted the mismatch',
        policyCitation: 'Dispute Policy §4.2',
      },
    });
    expect(JSON.stringify(input)).not.toContain(SUGGESTION);
  });

  it('still lets the person decide when the advisory cannot be loaded', async () => {
    answerWith(api.call, {
      'GET /admin/me': staff(MANAGE),
      'GET /cases/:id': detail(),
      'GET /cases/:id/trail': trail,
    });
    renderWithQuery(<CaseDetail caseId={CASE_ID} />);
    expect(await screen.findByRole('group', { name: 'Decision actions' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'AI-suggested — not a decision' })).toBeNull();
  });

  it('offers Take, not a decision form, on a case nobody owns', async () => {
    serve(MANAGE, detail({ ownerUserId: null, state: 'OPEN' }), {
      'POST /cases/:id/take': caseRow(1, { ownerUserId: ME }),
    });
    renderWithQuery(<CaseDetail caseId={CASE_ID} />);
    const take = await screen.findByRole('button', { name: 'Take this case' });
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
    fireEvent.click(take);
    await waitFor(() => expect(posts('/cases/:id/take')).toHaveLength(1));
  });

  it('says who owns a case that is not yours and offers to reassign it to you with a reason', async () => {
    serve(MANAGE, detail({ ownerUserId: OTHER }), { 'POST /cases/:id/reassign': caseRow(1) });
    renderWithQuery(<CaseDetail caseId={CASE_ID} />);
    await screen.findByText(/Only its owner can decide/);
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();

    const button = screen.getByRole('button', { name: 'Reassign to me' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason for reassigning'), {
      target: { value: 'Covering a shift' },
    });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(posts('/cases/:id/reassign')).toHaveLength(1));
    expect(posts('/cases/:id/reassign')[0]![1].body).toEqual({ toUserId: ME, reason: 'Covering a shift' });
  });

  it('shows a read-only person the case and the advisory but no way to act', async () => {
    serve(READ);
    renderWithQuery(<CaseDetail caseId={CASE_ID} />);
    await screen.findByRole('region', { name: 'AI-suggested — not a decision' });
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Take this case' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Escalate' })).toBeNull();
    expect(screen.getByText(/can read cases but not decide them/)).toBeTruthy();
  });

  it('shows a decided case with its decision and citation, and no form', async () => {
    serve(
      MANAGE,
      detail({
        state: 'DECIDED',
        decisions: [
          {
            id: id(60),
            caseId: CASE_ID,
            decidedByUserId: ME,
            outcome: 'Return and refund',
            reason: 'Seller accepted the mismatch',
            policyCitation: 'Dispute Policy §4.2',
            decidedAt: '2026-11-07T10:00:00.000Z',
          },
        ],
      }),
    );
    renderWithQuery(<CaseDetail caseId={CASE_ID} />);
    const recorded = await screen.findByRole('region', { name: 'Decision recorded' });
    expect(within(recorded).getByText('Return and refund')).toBeTruthy();
    expect(within(recorded).getByText(/Dispute Policy §4.2/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
  });

  it('escalates with a reason, and not without one', async () => {
    serve(MANAGE, detail(), { 'POST /cases/:id/escalate': caseRow(1, { state: 'ESCALATED' }) });
    renderWithQuery(<CaseDetail caseId={CASE_ID} />);
    await screen.findByRole('group', { name: 'Decision actions' });
    const button = screen.getByRole('button', { name: 'Escalate' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason for escalating'), { target: { value: 'Needs Tier 2' } });
    fireEvent.click(button);
    await waitFor(() => expect(posts('/cases/:id/escalate')).toHaveLength(1));
    expect(posts('/cases/:id/escalate')[0]![1].body).toEqual({ reason: 'Needs Tier 2' });
  });

  it('changes priority with a reason', async () => {
    serve(MANAGE, detail(), { 'POST /cases/:id/priority': caseRow(1, { priority: 'URGENT' }) });
    renderWithQuery(<CaseDetail caseId={CASE_ID} />);
    await screen.findByRole('group', { name: 'Decision actions' });
    fireEvent.change(screen.getByLabelText('New priority'), { target: { value: 'URGENT' } });
    fireEvent.change(screen.getByLabelText('Reason for the change'), { target: { value: 'Money is held' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change priority' }));
    await waitFor(() => expect(posts('/cases/:id/priority')).toHaveLength(1));
    expect(posts('/cases/:id/priority')[0]![1].body).toEqual({ priority: 'URGENT', reason: 'Money is held' });
  });

  it('asks for evidence and marks an open request fulfilled', async () => {
    serve(MANAGE, detail(), {
      'POST /cases/:id/evidence-requests': { case: caseRow(1), request: {} },
      'POST /cases/:id/evidence-requests/:requestId/resolve': { case: caseRow(1), request: {} },
    });
    renderWithQuery(<CaseDetail caseId={CASE_ID} />);
    await screen.findByText('Photo of the box label');

    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'Delivery receipt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request evidence' }));
    await waitFor(() => expect(posts('/cases/:id/evidence-requests')).toHaveLength(1));
    expect(posts('/cases/:id/evidence-requests')[0]![1].body).toEqual({ description: 'Delivery receipt' });

    fireEvent.click(screen.getByRole('button', { name: 'Mark fulfilled' }));
    await waitFor(() => expect(posts('/cases/:id/evidence-requests/:requestId/resolve')).toHaveLength(1));
    expect(posts('/cases/:id/evidence-requests/:requestId/resolve')[0]![1]).toEqual({
      params: { id: CASE_ID, requestId: id(50) },
      body: { status: 'FULFILLED' },
    });
  });

  it('offers a retry when the case cannot load', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(READ) });
    renderWithQuery(<CaseDetail caseId={CASE_ID} />);
    expect(await screen.findByText('We could not load this case')).toBeTruthy();
  });
});
