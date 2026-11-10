// @vitest-environment jsdom
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerificationCase } from '../src/identity/VerificationCase';
import { expectNoAxeViolations } from './axe';
import {
  callsTo,
  type CallFn,
  ME,
  SHELL_RULES,
  answerWith,
  caseRow,
  id,
  renderWithQuery,
  staff,
} from './support/cases';
import { ADVISORY, ANALYST, queueItem } from './support/kyc';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
vi.mock('@komtru/app-kit/react', () => ({ useApiClient: () => api }));

const REQUEST = id(201);
const CASE_ID = id(101);
const ITEM = '/admin/kyc/queue/:requestId';
const ASSIGN = '/admin/kyc/queue/:requestId/assign';
const DECIDE = '/admin/kyc/queue/:requestId/decide';
const RESOLVE = '/admin/kyc/duplicate-flags/:id/resolve';
const OVERRIDES = '/admin/kyc/overrides';
const APPROVE = '/admin/approvals/:approvalId/approve';

const item = (over: Record<string, unknown> = {}) => ({ ...queueItem(1, over), advisory: ADVISORY });

const caseDetail = (over: Record<string, unknown> = {}) => ({
  ...caseRow(1, { id: CASE_ID, type: 'IDENTITY', title: 'BVN needs a manual check', subjectId: REQUEST }),
  facts: { verificationType: 'BVN', reason: 'PROVIDER_REVIEW', attemptCount: 2, duplicateIdentity: false },
  evidenceRequests: [],
  decisions: [],
  ...over,
});

const trail = {
  items: [
    {
      id: 1,
      occurredAt: '2026-11-10T08:00:00.000Z',
      type: 'REGISTERED',
      actorUserId: null,
      reason: null,
      metadata: {},
    },
  ],
  nextCursor: null,
};

const serve = (permissions: string[], it = item(), extra: Record<string, unknown> = {}) =>
  answerWith(api.call, {
    'GET /admin/me': staff(permissions),
    [`GET ${ITEM}`]: it,
    'GET /cases/:id': caseDetail(),
    'GET /cases/:id/trail': trail,
    ...extra,
  });

const owned = { ownerUserId: ME, state: 'INVESTIGATING' };

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

describe('Verification case (OP-06)', () => {
  it('shows what is known in the case layout: the check, why it needs a person, the clock and the trail', async () => {
    serve(ANALYST, item(owned));
    const { container } = renderWithQuery(<VerificationCase requestId={REQUEST} />);

    expect(await screen.findByText('C-002801')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Bank Verification Number check' })).toBeTruthy();
    const evidence = await screen.findByRole('region', { name: 'Evidence' });
    expect(await within(evidence).findByText('Provider review')).toBeTruthy();
    expect(within(evidence).getByText('2')).toBeTruthy();
    expect(within(evidence).getByText('No')).toBeTruthy();
    const trailRegion = await screen.findByRole('region', { name: 'Trust Trail' });
    expect(within(trailRegion).getByText('Registered')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Back to People/ }).getAttribute('href')).toBe('/identity');
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('draws the advisory as prose in its own box and sends none of it', async () => {
    serve(ANALYST, item(owned), { [`POST ${DECIDE}`]: { requestId: REQUEST, status: 'APPROVED' } });
    renderWithQuery(<VerificationCase requestId={REQUEST} />);
    expect(await screen.findByText(ADVISORY.suggestion)).toBeTruthy();
    expect(screen.getByText(ADVISORY.label)).toBeTruthy();

    // Nothing is chosen or typed for the person; the button waits for both.
    const record = screen.getByRole('button', { name: 'Record decision' });
    expect((record as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText<HTMLTextAreaElement>('Reason').value).toBe('');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Approve/ }).checked).toBe(false);

    fireEvent.click(screen.getByRole('radio', { name: /Approve/ }));
    expect((record as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '   ' } });
    expect((record as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'BVN matches the register' } });
    expect((record as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(record);

    await waitFor(() => expect(callsTo(api.call, DECIDE)).toHaveLength(1));
    const [, input] = callsTo(api.call, DECIDE)[0] ?? [];
    expect(input?.params).toEqual({ requestId: REQUEST });
    expect(input?.body).toEqual({ outcome: 'APPROVE', reason: 'BVN matches the register' });
  });

  it('rejects with the analyst reason', async () => {
    serve(ANALYST, item(owned), { [`POST ${DECIDE}`]: { requestId: REQUEST, status: 'REJECTED' } });
    renderWithQuery(<VerificationCase requestId={REQUEST} />);
    await screen.findByText(ADVISORY.suggestion);
    fireEvent.click(screen.getByRole('radio', { name: /Reject/ }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Photo is of someone else' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await waitFor(() => expect(callsTo(api.call, DECIDE)).toHaveLength(1));
    expect(callsTo(api.call, DECIDE)[0]?.[1].body).toEqual({
      outcome: 'REJECT',
      reason: 'Photo is of someone else',
    });
  });

  it('asks to be taken first, then decides', async () => {
    serve(ANALYST, item(), { [`POST ${ASSIGN}`]: { id: CASE_ID, state: 'INVESTIGATING', ownerUserId: ME } });
    renderWithQuery(<VerificationCase requestId={REQUEST} />);
    await screen.findByText(ADVISORY.suggestion);
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Take this case' }));
    await waitFor(() => expect(callsTo(api.call, ASSIGN)).toHaveLength(1));
    expect(callsTo(api.call, ASSIGN)[0]?.[1].params).toEqual({ requestId: REQUEST });
  });

  it('shows the advisory and nothing to press to someone who may only view', async () => {
    serve(['verification.view'], item());
    renderWithQuery(<VerificationCase requestId={REQUEST} />);
    expect(await screen.findByText(ADVISORY.suggestion)).toBeTruthy();
    expect(screen.getByText('Your role can read verification cases but not decide them.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Take this case' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
  });

  it('does not fetch the universal case for someone without cases.view, and says the evidence is not theirs', async () => {
    serve(['verification.view', 'verification.review'], item(owned));
    renderWithQuery(<VerificationCase requestId={REQUEST} />);
    await screen.findByText(ADVISORY.suggestion);
    expect(callsTo(api.call, '/cases/:id')).toHaveLength(0);
    expect(callsTo(api.call, '/cases/:id/trail')).toHaveLength(0);
    expect(
      screen.getByText('Your role does not include the case evidence and the Trust Trail.'),
    ).toBeTruthy();
  });

  it('says what happened when the platform refuses', async () => {
    const refuse = () => {
      throw Object.assign(Object.create(ProblemError.prototype) as Error, { status: 409 });
    };
    serve(ANALYST, item(owned), { [`POST ${DECIDE}`]: refuse });
    renderWithQuery(<VerificationCase requestId={REQUEST} />);
    await screen.findByText(ADVISORY.suggestion);
    fireEvent.click(screen.getByRole('radio', { name: /Approve/ }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'ok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    expect(await screen.findByText(/changed while you were looking.*record the decision/)).toBeTruthy();
  });

  it('shows the decision recorded, and no form, for a finished case', async () => {
    serve(ANALYST, item({ state: 'DECIDED', ownerUserId: ME }), {
      'GET /cases/:id': caseDetail({
        state: 'DECIDED',
        decisions: [
          {
            id: id(60),
            caseId: CASE_ID,
            decidedByUserId: ME,
            outcome: 'APPROVED',
            reason: 'Matches the register',
            policyCitation: 'M6 §6.8',
            decidedAt: '2026-11-10T10:00:00.000Z',
          },
        ],
      }),
    });
    renderWithQuery(<VerificationCase requestId={REQUEST} />);
    const panel = await screen.findByRole('region', { name: 'Decision recorded' });
    expect(await within(panel).findByText('Matches the register')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
  });

  it('lets only the owner decide, and offers a takeover to someone who manages cases', async () => {
    const other = id(777);
    serve([...ANALYST, 'cases.manage'], item({ ownerUserId: other, state: 'INVESTIGATING' }), {
      'POST /cases/:id/reassign': caseRow(1),
    });
    renderWithQuery(<VerificationCase requestId={REQUEST} />);
    await screen.findByText(ADVISORY.suggestion);
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Reason for reassigning'), { target: { value: 'Covering' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reassign to me' }));
    await waitFor(() => expect(callsTo(api.call, '/cases/:id/reassign')).toHaveLength(1));
    expect(callsTo(api.call, '/cases/:id/reassign')[0]?.[1].body).toEqual({
      toUserId: ME,
      reason: 'Covering',
    });
  });

  it('does not offer a takeover without cases.manage', async () => {
    serve(ANALYST, item({ ownerUserId: id(777), state: 'INVESTIGATING' }));
    renderWithQuery(<VerificationCase requestId={REQUEST} />);
    await screen.findByText(ADVISORY.suggestion);
    expect(screen.queryByRole('button', { name: 'Reassign to me' })).toBeNull();
  });

  it('never calls the platform for someone without verification.view', async () => {
    serve(['duplicate_flag.view']);
    renderWithQuery(<VerificationCase requestId={REQUEST} />);
    expect(await screen.findByText('This verification case is not part of your role')).toBeTruthy();
    expect(callsTo(api.call, ITEM)).toHaveLength(0);
  });

  it('offers a retry when the case will not load', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(ANALYST) });
    renderWithQuery(<VerificationCase requestId={REQUEST} />);
    expect(await screen.findByText('We could not load this verification case')).toBeTruthy();
  });
});

const FLAGGED = { duplicateFlagId: id(401), duplicateFlagStatus: 'OPEN', priority: 'HIGH', ...owned };
const RESOLVER = [...ANALYST, 'duplicate_flag.view', 'duplicate_flag.resolve'];
const flagBody = { id: id(401) };

describe('Verification case with a duplicate flag', () => {
  it('routes the decision to the flag: the plain approve and reject are not offered', async () => {
    serve(RESOLVER, item(FLAGGED));
    renderWithQuery(<VerificationCase requestId={REQUEST} />);
    expect(await screen.findByRole('region', { name: 'Resolve the duplicate flag' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
    expect(screen.getByText(/already verified on another account/)).toBeTruthy();
  });

  it('confirms a duplicate with a reason', async () => {
    serve(RESOLVER, item(FLAGGED), { [`POST ${RESOLVE}`]: flagBody });
    renderWithQuery(<VerificationCase requestId={REQUEST} />);
    const panel = await screen.findByRole('region', { name: 'Resolve the duplicate flag' });
    fireEvent.change(within(panel).getByLabelText('Reason'), { target: { value: 'Same BVN, same face' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Confirm duplicate' }));
    await waitFor(() => expect(callsTo(api.call, RESOLVE)).toHaveLength(1));
    const [, input] = callsTo(api.call, RESOLVE)[0] ?? [];
    expect(input?.params).toEqual({ id: id(401) });
    expect(input?.body).toEqual({ resolution: 'CONFIRMED_DUPLICATE', reason: 'Same BVN, same face' });
  });

  it('escalates with a reason, and not without one', async () => {
    serve(RESOLVER, item(FLAGGED), { [`POST ${RESOLVE}`]: flagBody });
    renderWithQuery(<VerificationCase requestId={REQUEST} />);
    const panel = await screen.findByRole('region', { name: 'Resolve the duplicate flag' });
    const escalate = within(panel).getByRole<HTMLButtonElement>('button', { name: 'Escalate' });
    expect(escalate.disabled).toBe(true);
    fireEvent.change(within(panel).getByLabelText('Reason'), { target: { value: 'Needs compliance' } });
    fireEvent.click(escalate);
    await waitFor(() => expect(callsTo(api.call, RESOLVE)).toHaveLength(1));
    expect(callsTo(api.call, RESOLVE)[0]?.[1].body).toEqual({
      resolution: 'ESCALATED',
      reason: 'Needs compliance',
    });
  });

  it('clears a false positive in three steps: ask, a second person approves, then clear with that approval', async () => {
    const approval = id(900 + 9);
    serve([...RESOLVER, 'verification.override'], item(FLAGGED), {
      [`POST ${OVERRIDES}`]: { approvalId: approval, expiresAt: '2026-11-11T10:00:00.000Z' },
      [`POST ${APPROVE}`]: { approvalId: approval, action: 'VERIFICATION_OVERRIDE', state: 'APPROVED' },
      [`POST ${RESOLVE}`]: flagBody,
    });
    renderWithQuery(<VerificationCase requestId={REQUEST} />);
    const panel = await screen.findByRole('region', { name: 'Resolve the duplicate flag' });
    const clear = within(panel).getByRole<HTMLButtonElement>('button', { name: 'Clear the flag' });
    // No approval, no clearing: the button itself says so.
    fireEvent.change(within(panel).getByLabelText('Reason'), { target: { value: 'Two people, one typo' } });
    expect(clear.disabled).toBe(true);

    fireEvent.click(within(panel).getByRole('button', { name: 'Ask for a second approver' }));
    await waitFor(() => expect(callsTo(api.call, OVERRIDES)).toHaveLength(1));
    expect(callsTo(api.call, OVERRIDES)[0]?.[1].body).toEqual({
      kind: 'CLEAR_DUPLICATE',
      flagId: id(401),
      reason: 'Two people, one typo',
    });
    expect(await within(panel).findByText(approval)).toBeTruthy();
    expect(within(panel).getByLabelText<HTMLInputElement>('Approval number').value).toBe(approval);

    fireEvent.click(within(panel).getByRole('button', { name: 'Approve this clearance' }));
    await waitFor(() => expect(callsTo(api.call, APPROVE)).toHaveLength(1));
    expect(callsTo(api.call, APPROVE)[0]?.[1]).toMatchObject({
      params: { approvalId: approval },
      body: { reason: 'Two people, one typo' },
    });

    await waitFor(() => expect(clear.disabled).toBe(false));
    fireEvent.click(clear);
    await waitFor(() => expect(callsTo(api.call, RESOLVE)).toHaveLength(1));
    expect(callsTo(api.call, RESOLVE)[0]?.[1].body).toEqual({
      resolution: 'CLEARED_FALSE_POSITIVE',
      reason: 'Two people, one typo',
      approvalId: approval,
    });
  });

  it('hides asking for a clearance without verification.override, and the whole panel without duplicate_flag.resolve', async () => {
    serve(RESOLVER, item(FLAGGED));
    renderWithQuery(<VerificationCase requestId={REQUEST} />);
    const panel = await screen.findByRole('region', { name: 'Resolve the duplicate flag' });
    expect(within(panel).queryByRole('button', { name: 'Ask for a second approver' })).toBeNull();
    cleanup();

    api.call.mockReset();
    serve(ANALYST, item(FLAGGED));
    renderWithQuery(<VerificationCase requestId={REQUEST} />);
    await screen.findByText(ADVISORY.suggestion);
    expect(screen.queryByRole('region', { name: 'Resolve the duplicate flag' })).toBeNull();
    expect(screen.getByText('Your role cannot resolve duplicate-identity flags.')).toBeTruthy();
  });

  it('has no axe violations', async () => {
    serve([...RESOLVER, 'verification.override'], item(FLAGGED));
    const { container } = renderWithQuery(<VerificationCase requestId={REQUEST} />);
    await screen.findByRole('region', { name: 'Resolve the duplicate flag' });
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});
