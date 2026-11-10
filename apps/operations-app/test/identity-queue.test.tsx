// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeopleQueue } from '../src/identity/PeopleQueue';
import { expectNoAxeViolations } from './axe';
import { callsTo, type CallFn, SHELL_RULES, answerWith, id, renderWithQuery, staff } from './support/cases';
import { HOURS_AGO, flagRow, paged, queueItem, VIEWER_ONLY } from './support/kyc';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
vi.mock('@komtru/app-kit/react', () => ({ useApiClient: () => api }));

const QUEUE = '/admin/kyc/queue';
const FLAGS = '/admin/kyc/duplicate-flags';

const rows = [
  queueItem(1, { caseType: 'KYB', verificationType: 'CAC', submittedAt: HOURS_AGO(26) }),
  queueItem(2, { verificationType: 'BVN', submittedAt: HOURS_AGO(3) }),
  queueItem(3, { verificationType: 'NIN', duplicateFlagId: id(401), duplicateFlagStatus: 'OPEN' }),
];

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

describe('People, the verification queue (OP-05)', () => {
  it('lists who is waiting, what kind of check it is, what is known and how long they have waited', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(VIEWER_ONLY), [`GET ${QUEUE}`]: paged(rows) });
    const { container } = renderWithQuery(<PeopleQueue />);

    const table = await screen.findByRole('table', { name: 'Verification queue' });
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(3);

    const first = within(bodyRows[0] as HTMLElement);
    expect(first.getByText('Business registration (CAC)')).toBeTruthy();
    expect(first.getByText('Business')).toBeTruthy();
    expect(first.getByText('Needs a person')).toBeTruthy();
    expect(first.getByText('1d')).toBeTruthy();
    expect(first.getByRole('link', { name: /Review/ }).getAttribute('href')).toBe(`/identity/${id(201)}`);

    const second = within(bodyRows[1] as HTMLElement);
    expect(second.getByText('Individual')).toBeTruthy();
    expect(second.getByText('3h')).toBeTruthy();

    expect(within(bodyRows[2] as HTMLElement).getByText('Duplicate identity')).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('asks the platform for open items and filters by kind through the platform', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(VIEWER_ONLY), [`GET ${QUEUE}`]: paged(rows) });
    renderWithQuery(<PeopleQueue />);
    await screen.findByRole('table', { name: 'Verification queue' });
    expect(callsTo(api.call, QUEUE)[0]?.[1].query).toMatchObject({ show: 'open' });

    fireEvent.click(screen.getByRole('button', { name: 'Businesses' }));
    await waitFor(() =>
      expect(callsTo(api.call, QUEUE).some(([, input]) => input.query?.type === 'KYB')).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Individuals' }));
    await waitFor(() =>
      expect(callsTo(api.call, QUEUE).some(([, input]) => input.query?.type === 'IDENTITY')).toBe(true),
    );
  });

  it('narrows to those waiting over a day on the screen', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(VIEWER_ONLY), [`GET ${QUEUE}`]: paged(rows) });
    renderWithQuery(<PeopleQueue />);
    await screen.findByRole('table', { name: 'Verification queue' });
    fireEvent.click(screen.getByRole('button', { name: 'Waiting over 24h' }));
    const table = screen.getByRole('table', { name: 'Verification queue' });
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(1);
    expect(within(table).getByText('Business registration (CAC)')).toBeTruthy();
  });

  it('keeps loading pages while "Waiting over 24h" is on, so the answer is the whole queue and not the first page', async () => {
    answerWith(api.call, {
      'GET /admin/me': staff(VIEWER_ONLY),
      [`GET ${QUEUE}`]: (input: { query?: Record<string, unknown> }) =>
        input.query?.page === 2
          ? {
              items: [queueItem(8, { verificationType: 'CAC', caseType: 'KYB', submittedAt: HOURS_AGO(30) })],
              page: 2,
              limit: 1,
              total: 2,
            }
          : { items: [queueItem(1, { submittedAt: HOURS_AGO(2) })], page: 1, limit: 1, total: 2 },
    });
    renderWithQuery(<PeopleQueue />);
    await screen.findByRole('table', { name: 'Verification queue' });
    fireEvent.click(screen.getByRole('button', { name: 'Waiting over 24h' }));
    expect(await screen.findByText('Business registration (CAC)')).toBeTruthy();
    expect(callsTo(api.call, QUEUE).some(([, input]) => input.query?.page === 2)).toBe(true);
    const table = screen.getByRole('table', { name: 'Verification queue' });
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(1);
  });

  it('loads further pages by page number until the total is reached', async () => {
    answerWith(api.call, {
      'GET /admin/me': staff(VIEWER_ONLY),
      [`GET ${QUEUE}`]: (input: { query?: Record<string, unknown> }) =>
        input.query?.page === 2
          ? { items: [queueItem(9)], page: 2, limit: 1, total: 2 }
          : { items: [queueItem(1)], page: 1, limit: 1, total: 2 },
    });
    renderWithQuery(<PeopleQueue />);
    await screen.findByRole('table', { name: 'Verification queue' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('table', { name: 'Verification queue' })).getAllByRole('row'),
      ).toHaveLength(3),
    );
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('says so when nothing is waiting, and offers a retry when the list will not load', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(VIEWER_ONLY), [`GET ${QUEUE}`]: paged([]) });
    renderWithQuery(<PeopleQueue />);
    expect(await screen.findByText('Nobody is waiting')).toBeTruthy();
    cleanup();

    api.call.mockReset();
    answerWith(api.call, { 'GET /admin/me': staff(VIEWER_ONLY) });
    renderWithQuery(<PeopleQueue />);
    expect(await screen.findByText('We could not load the queue')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('never calls the queue for someone without verification.view, and says why', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(['duplicate_flag.view']), [`GET ${FLAGS}`]: paged([]) });
    renderWithQuery(<PeopleQueue />);
    expect(await screen.findByText('The verification queue is not part of your role')).toBeTruthy();
    expect(callsTo(api.call, QUEUE)).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Verification queue' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Duplicate flags' })).toBeTruthy();
  });

  it('shows the duplicate flags tab only to someone holding duplicate_flag.view', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(VIEWER_ONLY), [`GET ${QUEUE}`]: paged([]) });
    renderWithQuery(<PeopleQueue />);
    await screen.findByText('Nobody is waiting');
    expect(screen.queryByRole('link', { name: 'Duplicate flags' })).toBeNull();
  });
});

describe('Duplicate identity flags', () => {
  it('lists open flags first, each opening its verification case', async () => {
    answerWith(api.call, {
      'GET /admin/me': staff(['verification.view', 'duplicate_flag.view']),
      [`GET ${FLAGS}`]: paged([flagRow(1), flagRow(2, { status: 'ESCALATED' })]),
    });
    const { container } = renderWithQuery(<PeopleQueue view="flags" />);
    const table = await screen.findByRole('table', { name: 'Duplicate identity flags' });
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(2);
    expect(within(bodyRows[0] as HTMLElement).getByText('Open')).toBeTruthy();
    expect(within(bodyRows[1] as HTMLElement).getByText('Escalated')).toBeTruthy();
    expect(
      within(bodyRows[0] as HTMLElement)
        .getByRole('link', { name: /Review/ })
        .getAttribute('href'),
    ).toBe(`/identity/${id(201)}`);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('does not call the flags without duplicate_flag.view', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(VIEWER_ONLY) });
    renderWithQuery(<PeopleQueue view="flags" />);
    expect(await screen.findByText('Duplicate flags are not part of your role')).toBeTruthy();
    expect(callsTo(api.call, FLAGS)).toHaveLength(0);
  });
});
