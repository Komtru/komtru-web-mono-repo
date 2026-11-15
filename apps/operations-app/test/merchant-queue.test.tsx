// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MerchantQueue } from '../src/merchant/MerchantQueue';
import { expectNoAxeViolations } from './axe';
import { callsTo, type CallFn, SHELL_RULES, answerWith, id, renderWithQuery, staff } from './support/cases';
import { HOURS_AGO, paged } from './support/kyc';
import { STANDARDS, VIEWER, queueRow } from './support/merchant';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
vi.mock('@komtru/app-kit/react', () => ({ useApiClient: () => api }));

const QUEUE = '/admin/merchant/applications';
const COUNT = '/admin/merchant/applications/count';

const rows = [
  queueRow(1, { slaDueAt: '2000-01-01T00:00:00.000Z', submittedAt: HOURS_AGO(30), submissionCount: 2 }),
  queueRow(2, {
    businessName: 'Laptop Hub',
    categories: ['LAPTOPS', 'PHONES'],
    status: 'IN_REVIEW',
    caseState: 'INVESTIGATING',
  }),
  queueRow(3, { businessName: 'Waiting Ltd', status: 'CHANGES_REQUESTED', caseState: 'CLOSED' }),
];

const serve = (permissions = VIEWER, items: unknown[] = rows, extra: Record<string, unknown> = {}) =>
  answerWith(api.call, {
    'GET /admin/me': staff(permissions),
    [`GET ${QUEUE}`]: paged(items),
    [`GET ${COUNT}`]: { awaitingReview: 2 },
    'GET /config/trade-standards': STANDARDS,
    ...extra,
  });

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

describe('Merchant Applications, the queue (T-154)', () => {
  it('lists each application with its business, categories, status, clock and age, opening its case', async () => {
    serve();
    const { container } = renderWithQuery(<MerchantQueue />);
    const table = await screen.findByRole('table', { name: 'Merchant applications' });
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(3);

    const first = within(bodyRows[0] as HTMLElement);
    expect(first.getByText('Techedge Nigeria Ltd')).toBeTruthy();
    expect(first.getByText(/C-002901 · KMT-U-AB12C1 · submission 2/)).toBeTruthy();
    expect(first.getByText('Registered business')).toBeTruthy();
    expect(first.getByText('Awaiting review')).toBeTruthy();
    expect(first.getByText('Overdue')).toBeTruthy();
    expect(first.getByText('1d')).toBeTruthy();
    expect(
      first.getByRole('link', { name: /Review Techedge Nigeria Ltd C-002901/ }).getAttribute('href'),
    ).toBe(`/merchant-applications/${id(601)}`);

    const second = within(bodyRows[1] as HTMLElement);
    expect(second.getByText('In review')).toBeTruthy();
    expect(second.getByText('Laptops, Phones')).toBeTruthy();
    expect(second.getByText(/Due in/)).toBeTruthy();

    // A clock that has stopped is not "Overdue": the applicant has the ball.
    const third = within(bodyRows[2] as HTMLElement);
    expect(third.getByText('Waiting on the applicant')).toBeTruthy();
    expect(third.getByText('Stopped')).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('asks the platform for what awaits a person, in the platform’s own order', async () => {
    serve();
    renderWithQuery(<MerchantQueue />);
    await screen.findByRole('table', { name: 'Merchant applications' });
    expect(callsTo(api.call, QUEUE)[0]?.[1].query).toMatchObject({ show: 'open', page: 1 });
    expect(callsTo(api.call, QUEUE)[0]?.[1].query).not.toHaveProperty('status');
  });

  it('filters by status and by category, both through the platform', async () => {
    serve();
    renderWithQuery(<MerchantQueue />);
    await screen.findByRole('table', { name: 'Merchant applications' });

    fireEvent.click(screen.getByRole('button', { name: 'Changes requested' }));
    await waitFor(() =>
      expect(callsTo(api.call, QUEUE).some(([, input]) => input.query?.status === 'CHANGES_REQUESTED')).toBe(
        true,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rejected' }));
    await waitFor(() =>
      expect(callsTo(api.call, QUEUE).some(([, input]) => input.query?.status === 'REJECTED')).toBe(true),
    );

    await screen.findByRole('option', { name: 'Laptops' });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'LAPTOPS' } });
    await waitFor(() =>
      expect(
        callsTo(api.call, QUEUE).some(
          ([, input]) => input.query?.category === 'LAPTOPS' && input.query?.status === 'REJECTED',
        ),
      ).toBe(true),
    );
  });

  it('loads further pages by page number until the total is reached', async () => {
    serve(VIEWER, [], {
      [`GET ${QUEUE}`]: (input: { query?: Record<string, unknown> }) =>
        input.query?.page === 2
          ? { items: [queueRow(9)], page: 2, limit: 1, total: 2 }
          : { items: [queueRow(1)], page: 1, limit: 1, total: 2 },
    });
    renderWithQuery(<MerchantQueue />);
    await screen.findByRole('table', { name: 'Merchant applications' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('table', { name: 'Merchant applications' })).getAllByRole('row'),
      ).toHaveLength(3),
    );
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('says so when nothing is waiting, and offers a retry when the list will not load', async () => {
    serve(VIEWER, []);
    renderWithQuery(<MerchantQueue />);
    expect(await screen.findByText('No applications here')).toBeTruthy();
    expect(screen.getByText(/Nothing is waiting for a decision/)).toBeTruthy();
    cleanup();

    api.call.mockReset();
    answerWith(api.call, { 'GET /admin/me': staff(VIEWER), 'GET /config/trade-standards': STANDARDS });
    renderWithQuery(<MerchantQueue />);
    expect(await screen.findByText('We could not load the applications')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('never calls the queue for someone without merchant.application.view, and says why', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(['verification.view']) });
    renderWithQuery(<MerchantQueue />);
    expect(await screen.findByText('This section is not part of your role')).toBeTruthy();
    expect(callsTo(api.call, QUEUE)).toHaveLength(0);
    expect(callsTo(api.call, COUNT)).toHaveLength(0);
  });
});

describe('the sidebar item', () => {
  const railLabels = () =>
    within(screen.getByRole('navigation', { name: 'Console sections' }))
      .getAllByRole('link')
      .map((link) => link.getAttribute('aria-label'));

  it('carries the count of applications awaiting review', async () => {
    serve();
    renderWithQuery(<MerchantQueue />);
    await waitFor(() => expect(railLabels()).toContain('Merchant Applications (2)'));
    expect(screen.getByRole('link', { name: 'Merchant Applications (2)' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('draws the item without a number when none are waiting, or when the count will not load', async () => {
    serve(VIEWER, rows, { [`GET ${COUNT}`]: { awaitingReview: 0 } });
    renderWithQuery(<MerchantQueue />);
    await screen.findByRole('table', { name: 'Merchant applications' });
    expect(railLabels()).toContain('Merchant Applications');
    cleanup();

    api.call.mockReset();
    answerWith(api.call, {
      'GET /admin/me': staff(VIEWER),
      [`GET ${QUEUE}`]: paged(rows),
      'GET /config/trade-standards': STANDARDS,
    });
    renderWithQuery(<MerchantQueue />);
    await screen.findByRole('table', { name: 'Merchant applications' });
    expect(railLabels()).toContain('Merchant Applications');
  });

  it('does not ask for the count, or draw the item, for someone without merchant.application.view', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(['cases.view']) });
    renderWithQuery(<MerchantQueue />);
    await screen.findByText('This section is not part of your role');
    expect(callsTo(api.call, COUNT)).toHaveLength(0);
    expect(railLabels().some((label) => label?.startsWith('Merchant Applications'))).toBe(false);
  });
});
