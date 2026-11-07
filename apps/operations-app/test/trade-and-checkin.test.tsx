// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProposalCheckIn } from '../src/cases/ProposalCheckIn';
import { TradeView } from '../src/cases/TradeView';
import { expectNoAxeViolations } from './axe';
import { READ, SHELL_RULES, answerWith, caseRow, id, page, renderWithQuery, staff } from './support/cases';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@komtru/app-kit/react', () => ({ useApiClient: () => api }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();
const DAY = 24 * 60;

describe('Trade 360 (OP-12)', () => {
  const dispute = caseRow(1, {
    type: 'DISPUTE',
    title: 'Dispute opened, return approved',
    subjectType: 'TRADE',
    subjectId: 'KMT-90428',
    state: 'INVESTIGATING',
  });
  const trail = {
    items: [
      { id: 2, occurredAt: minutesAgo(30), type: 'TAKEN', actorUserId: null, reason: null, metadata: {} },
      {
        id: 1,
        occurredAt: minutesAgo(90),
        type: 'REGISTERED',
        actorUserId: null,
        reason: null,
        metadata: {},
      },
    ],
    nextCursor: null,
  };

  it('looks cases up by the trade reference and shows each with its Trust Trail', async () => {
    answerWith(api.call, {
      'GET /admin/me': staff([...READ, 'trade.view']),
      'GET /cases': page([dispute]),
      'GET /cases/:id/trail': trail,
    });
    const { container } = renderWithQuery(<TradeView reference="KMT-90428" />);

    const cases = await screen.findByRole('table', { name: 'Cases on this Trade' });
    expect(within(cases).getByText('Dispute opened, return approved')).toBeTruthy();
    const call = api.call.mock.calls.find(([endpoint]) => endpoint.path === '/cases');
    expect(call?.[1].query).toMatchObject({ subjectType: 'TRADE', subjectId: 'KMT-90428' });

    const history = await screen.findByRole('region', { name: 'Trust Trail' });
    expect(within(history).getByText('Registered')).toBeTruthy();
    expect(screen.getByRole('link', { name: dispute.code }).getAttribute('href')).toBe(
      `/queue/cases/${id(1)}`,
    );
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says so when no case has been opened on the trade', async () => {
    answerWith(api.call, { 'GET /admin/me': staff([...READ, 'trade.view']), 'GET /cases': page([]) });
    renderWithQuery(<TradeView reference="KMT-1" />);
    expect(await screen.findByText('No cases on this Trade')).toBeTruthy();
  });
});

describe('Proposal check-in (P1)', () => {
  const flagged = [
    caseRow(1, {
      title: 'Unverified number',
      subjectId: 'KMT-90138',
      priority: 'URGENT',
      state: 'ESCALATED',
    }),
    caseRow(2, { title: 'First trade', subjectId: 'KMT-90142', priority: 'NORMAL' }),
  ];
  const clearedToday = caseRow(3, {
    title: 'Verifying',
    subjectId: 'KMT-90121',
    state: 'DECIDED',
    decidedAt: minutesAgo(8),
    updatedAt: minutesAgo(8),
  });
  const clearedLongAgo = caseRow(4, {
    title: 'Old one',
    subjectId: 'KMT-80001',
    state: 'CLOSED',
    closedAt: minutesAgo(3 * DAY),
    updatedAt: minutesAgo(3 * DAY),
  });

  it('counts the flagged proposals and lists what was cleared today, newest facts first', async () => {
    answerWith(api.call, {
      'GET /admin/me': staff(READ),
      'GET /cases': page([...flagged, clearedToday, clearedLongAgo]),
    });
    const { container } = renderWithQuery(<ProposalCheckIn />);

    expect(await screen.findByText('2 flagged')).toBeTruthy();
    const open = screen.getByRole('list', { name: 'Flagged proposals' });
    expect(within(open).getByText('KMT-90138')).toBeTruthy();
    expect(within(open).getByText(/Urgent/)).toBeTruthy();

    const cleared = screen.getByRole('list', { name: 'Cleared today' });
    expect(within(cleared).getByText(/KMT-90121/)).toBeTruthy();
    expect(within(cleared).getByText('8m')).toBeTruthy();
    expect(within(cleared).queryByText(/KMT-80001/)).toBeNull();

    const call = api.call.mock.calls.find(([endpoint]) => endpoint.path === '/cases');
    expect(call?.[1].query.type).toBe('TRADE_PROPOSAL');
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says nothing is flagged when the list is clear', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(READ), 'GET /cases': page([]) });
    renderWithQuery(<ProposalCheckIn />);
    expect(await screen.findByText('Nothing flagged')).toBeTruthy();
  });
});
