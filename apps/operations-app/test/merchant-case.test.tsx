// @vitest-environment jsdom
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MerchantCase } from '../src/merchant/MerchantCase';
import { evidenceRows } from '../src/merchant/format';
import { expectNoAxeViolations } from './axe';
import {
  callsTo,
  type CallFn,
  ME,
  SHELL_RULES,
  answerWith,
  id,
  renderWithQuery,
  staff,
} from './support/cases';
import { ADVISORY, DECIDER, VIEWER, detail, evidence } from './support/merchant';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
vi.mock('@komtru/app-kit/react', () => ({ useApiClient: () => api }));

const APPLICATION = id(601);
const ITEM = '/admin/merchant/applications/:id';
const ASSIGN = '/admin/merchant/applications/:id/assign';
const APPROVE = '/admin/merchant/applications/:id/approve';
const REJECT = '/admin/merchant/applications/:id/reject';
const CHANGES = '/admin/merchant/applications/:id/request-changes';
const COUNT = '/admin/merchant/applications/count';

const trail = {
  items: [
    {
      id: 1,
      occurredAt: '2026-11-10T09:00:00.000Z',
      type: 'REGISTERED',
      actorUserId: null,
      reason: null,
      metadata: {},
    },
  ],
  nextCursor: null,
};

const serve = (permissions: string[], item = detail(1), extra: Record<string, unknown> = {}) =>
  answerWith(api.call, {
    'GET /admin/me': staff(permissions),
    [`GET ${ITEM}`]: item,
    [`GET ${COUNT}`]: { awaitingReview: 1 },
    'GET /cases/:id/trail': trail,
    ...extra,
  });

const owned = { ownerUserId: ME, caseState: 'INVESTIGATING', status: 'IN_REVIEW' };

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

describe('the merchant application case (OP-61, T-154)', () => {
  it('shows what is known in the case layout: the application, its documents, the evidence, the applicant and the trail', async () => {
    // Photos, not PDFs: axe cannot message a frame inside jsdom, and the frame is covered by the next test.
    const photos = detail(1).documents.map((document) => ({
      ...document,
      contentType: 'image/jpeg',
      url: document.url === null ? null : 'https://files.test/photo.jpg',
    }));
    serve(DECIDER, detail(1, { ...owned, documents: photos }));
    const { container } = renderWithQuery(<MerchantCase applicationId={APPLICATION} />);

    expect(await screen.findByText('C-002901')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Techedge Nigeria Ltd — merchant application' })).toBeTruthy();

    const application = await screen.findByRole('region', { name: 'Application' });
    expect(within(application).getByText('12 Allen Avenue, Ikeja, Lagos')).toBeTruthy();
    expect(within(application).getByText('Registered business')).toBeTruthy();
    expect(within(application).getByText('123456')).toBeTruthy();

    const applicant = screen.getByRole('region', { name: 'Applicant' });
    expect(within(applicant).getByText('Level 2 · Identity verified')).toBeTruthy();
    expect(within(applicant).getByText('4 trades, 3 completed')).toBeTruthy();
    expect(within(applicant).getByText(/@techedge/)).toBeTruthy();

    const log = screen.getByRole('region', { name: 'Status log' });
    expect(within(log).getByText(/Draft → Submitted/)).toBeTruthy();
    const trailRegion = await screen.findByRole('region', { name: 'Trust Trail' });
    expect(within(trailRegion).getByText('Registered')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Back to Merchant Applications/ }).getAttribute('href')).toBe(
      '/merchant-applications',
    );
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('views the documents inline: a PDF in a frame, a photo as an image, and says so when a file is unavailable', async () => {
    serve(DECIDER, detail(1, owned));
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    const documents = await screen.findByRole('region', { name: 'Documents' });
    expect(within(documents).getByTitle('CAC certificate').getAttribute('src')).toBe(
      'https://files.test/cac.pdf',
    );
    expect(
      within(documents).getByRole('img', { name: 'Proprietor or director ID' }).getAttribute('src'),
    ).toBe('https://files.test/id.jpg');
    expect(within(documents).getByText(/This file is not available/)).toBeTruthy();
    const open = within(documents).getAllByRole('link', { name: 'Open in a new tab' });
    expect(open).toHaveLength(2);
    expect(open[0]?.getAttribute('rel')).toContain('noopener');
    expect(within(documents).getByText(/Every view of a document is recorded against you/)).toBeTruthy();
  });

  it('draws the evidence matrix: identity level, the CAC lookup, the documents and the bank name-match', async () => {
    serve(
      DECIDER,
      detail(1, {
        ...owned,
        evidence: evidence({
          identityLevel: 1,
          cacLookup: { state: 'FAILED' },
          bankNameMatch: {
            state: 'MISMATCH',
            bankName: 'Access Bank',
            accountNumberMasked: '******5567',
            resolvedAccountName: 'ADA OKAFOR',
          },
          documents: {
            required: [],
            present: ['CAC_CERTIFICATE'],
            missing: ['STATUS_REPORT_OR_MEMORANDUM', 'DIRECTOR_ID'],
            complete: false,
          },
        }),
      }),
    );
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    const matrix = await screen.findByRole('region', { name: 'Evidence matrix' });
    const items = within(matrix).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]?.textContent).toMatch(/Applicant identity.*identity not yet verified.*Gap/);
    expect(items[1]?.textContent).toMatch(/CAC lookup.*did not verify the business.*Gap/);
    expect(items[2]?.textContent).toMatch(
      /Documents present.*Missing: Status report or memorandum, Director id.*Gap/,
    );
    expect(items[3]?.textContent).toMatch(
      /Bank name-match.*Access Bank \*{6}5567 is in a different name: ADA OKAFOR.*Gap/,
    );
  });

  it('reads each evidence state for what a reviewer would conclude, and never as a decision', () => {
    const rows = (over: Record<string, unknown>) =>
      evidenceRows(evidence(over) as Parameters<typeof evidenceRows>[0]);
    expect(rows({}).map((row) => row.state)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(rows({ cacLookup: { state: 'PENDING' } })[1]).toMatchObject({ state: 'check' });
    expect(rows({ cacLookup: { state: 'MANUAL_REVIEW' } })[1]).toMatchObject({ state: 'check' });
    expect(rows({ cacLookup: { state: 'NOT_RUN' } })[1]).toMatchObject({ state: 'gap' });
    // A verified business whose officers do not include the applicant is for a person to weigh.
    expect(rows({ cacLookup: { state: 'VERIFIED', officersMatch: false } })[1]).toMatchObject({
      state: 'check',
    });
    expect(rows({ cacLookup: { state: 'VERIFIED', rcMatchesApplication: false } })[1]).toMatchObject({
      state: 'check',
    });
    expect(rows({ bankNameMatch: { state: 'FUZZY_MATCH' } })[3]).toMatchObject({ state: 'check' });
    expect(rows({ bankNameMatch: { state: 'NOT_RUN' } })[3]).toMatchObject({ state: 'gap' });
  });

  it('draws the advisory as prose in its own box and sends none of it', async () => {
    serve(DECIDER, detail(1, owned), {
      [`POST ${APPROVE}`]: { applicationId: APPLICATION, status: 'APPROVED' },
    });
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    expect(await screen.findByText(ADVISORY.suggestion)).toBeTruthy();
    expect(screen.getByText(ADVISORY.label)).toBeTruthy();

    // Nothing is chosen or typed for the person; the button waits for all three.
    const record = screen.getByRole('button', { name: 'Record decision' });
    expect((record as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText<HTMLTextAreaElement>('Reason').value).toBe('');
    expect(screen.getByLabelText<HTMLInputElement>('Policy cited').value).toBe('');
    for (const name of [/Approve/, /Request changes/, /Reject/]) {
      expect(screen.getByRole<HTMLInputElement>('radio', { name }).checked).toBe(false);
    }

    fireEvent.click(screen.getByRole('radio', { name: /Approve/ }));
    expect((record as HTMLButtonElement).disabled).toBe(true);
    fill('Reason', '   ');
    fill('Policy cited', 'Design §6.3');
    expect((record as HTMLButtonElement).disabled).toBe(true);
    fill('Reason', 'CAC record and ID both match');
    fill('Policy cited', '   ');
    expect((record as HTMLButtonElement).disabled).toBe(true);
    fill('Policy cited', 'Design §6.3, CAC documents are mandatory');
    expect((record as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(record);

    await waitFor(() => expect(callsTo(api.call, APPROVE)).toHaveLength(1));
    const [, input] = callsTo(api.call, APPROVE)[0] ?? [];
    expect(input?.params).toEqual({ id: APPLICATION });
    expect(input?.body).toEqual({
      reason: 'CAC record and ID both match',
      policyCitation: 'Design §6.3, CAC documents are mandatory',
    });
  });

  it('explains what approving does before it is done', async () => {
    serve(DECIDER, detail(1, owned));
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    await screen.findByText(ADVISORY.suggestion);
    fireEvent.click(screen.getByRole('radio', { name: /Approve/ }));
    expect(screen.getByText(/sell-only/)).toBeTruthy();
    expect(screen.getByText(/Verified Merchant badge/)).toBeTruthy();
  });

  it('rejects with the reviewer’s reason and policy', async () => {
    serve(DECIDER, detail(1, owned), {
      [`POST ${REJECT}`]: { applicationId: APPLICATION, status: 'REJECTED' },
    });
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    await screen.findByText(ADVISORY.suggestion);
    fireEvent.click(screen.getByRole('radio', { name: /Reject/ }));
    fill('Reason', 'The CAC number belongs to another business');
    fill('Policy cited', 'Design §6.3');
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await waitFor(() => expect(callsTo(api.call, REJECT)).toHaveLength(1));
    expect(callsTo(api.call, REJECT)[0]?.[1].body).toEqual({
      reason: 'The CAC number belongs to another business',
      policyCitation: 'Design §6.3',
    });
  });

  it('requests changes by picking documents and fields, and needs at least one', async () => {
    serve(DECIDER, detail(1, owned), {
      [`POST ${CHANGES}`]: { applicationId: APPLICATION, status: 'CHANGES_REQUESTED' },
    });
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    await screen.findByText(ADVISORY.suggestion);
    expect(screen.queryByRole('group', { name: 'What the applicant should change' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /Request changes/ }));
    const record = screen.getByRole('button', { name: 'Record decision' });
    fill('Reason', 'The scan is cut off');
    fill('Policy cited', 'Design §6.3');
    // A reason and a policy are not enough: nothing is named yet.
    expect((record as HTMLButtonElement).disabled).toBe(true);

    const picker = screen.getByRole('group', { name: 'What the applicant should change' });
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'CAC certificate' }));
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'CAC registration number' }));
    expect((record as HTMLButtonElement).disabled).toBe(false);
    // Unticking the last one takes the button away again.
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'CAC registration number' }));
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'CAC certificate' }));
    expect((record as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'CAC certificate' }));
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'CAC registration number' }));
    fireEvent.click(record);

    await waitFor(() => expect(callsTo(api.call, CHANGES)).toHaveLength(1));
    expect(callsTo(api.call, CHANGES)[0]?.[1].body).toEqual({
      reason: 'The scan is cut off',
      policyCitation: 'Design §6.3',
      requested: [
        { kind: 'DOCUMENT', key: 'CAC_CERTIFICATE' },
        { kind: 'FIELD', key: 'cacRcNumber' },
      ],
    });
  });

  it('asks to be taken first, then decides', async () => {
    serve(DECIDER, detail(1), {
      [`POST ${ASSIGN}`]: { applicationId: APPLICATION, status: 'IN_REVIEW', ownerUserId: ME },
    });
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    await screen.findByText(ADVISORY.suggestion);
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Take this application' }));
    await waitFor(() => expect(callsTo(api.call, ASSIGN)).toHaveLength(1));
    expect(callsTo(api.call, ASSIGN)[0]?.[1].params).toEqual({ id: APPLICATION });
  });

  it('refreshes the application and the count after a decision, so the queue leaves it at once', async () => {
    serve(DECIDER, detail(1, owned), {
      [`POST ${APPROVE}`]: { applicationId: APPLICATION, status: 'APPROVED' },
    });
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    await screen.findByText(ADVISORY.suggestion);
    const before = callsTo(api.call, ITEM).length;
    fireEvent.click(screen.getByRole('radio', { name: /Approve/ }));
    fill('Reason', 'Verified');
    fill('Policy cited', 'Design §6.3');
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await waitFor(() => expect(callsTo(api.call, ITEM).length).toBeGreaterThan(before));
    await waitFor(() => expect(callsTo(api.call, COUNT).length).toBeGreaterThan(1));
  });

  it('shows someone who may only view the advisory and nothing to press', async () => {
    serve(VIEWER, detail(1));
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    expect(await screen.findByText(ADVISORY.suggestion)).toBeTruthy();
    expect(screen.getByText('Your role can read merchant applications but not decide them.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Take this application' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
  });

  it('offers a takeover only to someone who manages cases, when someone else owns it', async () => {
    const other = { ownerUserId: id(951), caseState: 'INVESTIGATING', status: 'IN_REVIEW' };
    serve(DECIDER, detail(1, other));
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    await screen.findByText(/owns this application\. Only its owner can decide it\./);
    expect(screen.queryByLabelText('Reason for reassigning')).toBeNull();
    cleanup();

    api.call.mockReset();
    serve([...DECIDER, 'cases.manage'], detail(1, other));
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    expect(await screen.findByLabelText('Reason for reassigning')).toBeTruthy();
  });

  it('does not fetch the universal case trail for someone without cases.view', async () => {
    serve(['merchant.application.view', 'merchant.application.decide'], detail(1, owned));
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    await screen.findByText(ADVISORY.suggestion);
    expect(callsTo(api.call, '/cases/:id/trail')).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'Trust Trail' })).toBeNull();
  });

  it('shows a recorded decision with its reason and policy instead of the form', async () => {
    const decided = detail(1, {
      status: 'REJECTED',
      caseState: 'CLOSED',
      ownerUserId: ME,
      history: [
        ...detail(1).history,
        {
          fromStatus: 'IN_REVIEW',
          toStatus: 'REJECTED',
          actorType: 'STAFF',
          actorUserId: ME,
          reason: 'The CAC number belongs to another business',
          policyCitation: 'Design §6.3',
          requested: [],
          createdAt: '2026-11-11T09:00:00.000Z',
        },
      ],
    });
    serve(DECIDER, decided);
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    const recorded = await screen.findByRole('region', { name: 'Decision recorded' });
    expect(within(recorded).getByText('Rejected')).toBeTruthy();
    expect(within(recorded).getByText('The CAC number belongs to another business')).toBeTruthy();
    expect(within(recorded).getByText(/Applied per Design §6.3/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
  });

  it('shows what was asked for while the applicant has it, and that it returns on resubmission', async () => {
    const waiting = detail(1, {
      status: 'CHANGES_REQUESTED',
      caseState: 'CLOSED',
      changesRequested: [
        { kind: 'DOCUMENT', key: 'CAC_CERTIFICATE', note: 'Whole page' },
        { kind: 'FIELD', key: 'cacRcNumber' },
      ],
      history: [
        ...detail(1).history,
        {
          fromStatus: 'IN_REVIEW',
          toStatus: 'CHANGES_REQUESTED',
          actorType: 'STAFF',
          actorUserId: ME,
          reason: 'The scan is cut off',
          policyCitation: 'Design §6.3',
          requested: [
            { kind: 'DOCUMENT', key: 'CAC_CERTIFICATE' },
            { kind: 'FIELD', key: 'cacRcNumber' },
          ],
          createdAt: '2026-11-11T09:00:00.000Z',
        },
      ],
    });
    serve(DECIDER, waiting);
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    const application = await screen.findByRole('region', { name: 'Application' });
    expect(
      within(application).getByText(
        /Waiting on the applicant to change: CAC certificate, CAC registration number/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/returns here, as a new submission/)).toBeTruthy();
    // Once in the decision recorded, once in the status log that holds it.
    expect(screen.getAllByText('Asked for: CAC certificate, CAC registration number')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
  });

  it('says what happened when the platform refuses a decision', async () => {
    const refuse = () => {
      throw Object.assign(Object.create(ProblemError.prototype) as Error, { status: 409 });
    };
    serve(DECIDER, detail(1, owned), { [`POST ${APPROVE}`]: refuse });
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    await screen.findByText(ADVISORY.suggestion);
    fireEvent.click(screen.getByRole('radio', { name: /Approve/ }));
    fill('Reason', 'Verified');
    fill('Policy cited', 'Design §6.3');
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    expect(await screen.findByText(/The case changed while you were looking/)).toBeTruthy();
  });

  it('says so for an application that does not exist, and offers a retry for one that will not load', async () => {
    const missing = () => {
      throw Object.assign(Object.create(ProblemError.prototype) as Error, { status: 404 });
    };
    serve(DECIDER, detail(1), { [`GET ${ITEM}`]: missing });
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    expect(await screen.findByText('There is no such application')).toBeTruthy();
    cleanup();

    api.call.mockReset();
    serve(DECIDER, detail(1), {
      [`GET ${ITEM}`]: () => {
        throw new Error('boom');
      },
    });
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    expect(await screen.findByText('We could not load this application')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('never calls the application for someone without merchant.application.view', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(['verification.view']) });
    renderWithQuery(<MerchantCase applicationId={APPLICATION} />);
    expect(await screen.findByText('This section is not part of your role')).toBeTruthy();
    expect(callsTo(api.call, ITEM)).toHaveLength(0);
  });
});
