// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Alerts } from '../src/cases/Alerts';
import { CasesList } from '../src/cases/CasesList';
import { MyWork } from '../src/cases/MyWork';
import { TeamQueue } from '../src/cases/TeamQueue';
import { Today } from '../src/cases/Today';
import { expectNoAxeViolations } from './axe';
import {
  callsTo,
  type CallFn,
  MANAGE,
  READ,
  SHELL_RULES,
  ME,
  answerWith,
  caseRow,
  id,
  page,
  renderWithQuery,
  staff,
} from './support/cases';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
vi.mock('@komtru/app-kit/react', () => ({ useApiClient: () => api }));

const counts = { mine: 6, mineUrgent: 2, unassigned: 11, escalated: 3, slaAtRisk: 4 };
const sla = (status: 'AT_RISK' | 'BREACHED', remainingMinutes: number | null) => ({
  status,
  dueAt: '2026-11-07T10:00:00.000Z',
  remainingMinutes,
  hours: 24,
  startedAt: '2026-11-06T10:00:00.000Z',
});

const queueByView =
  (views: Record<string, ReturnType<typeof page>>) => (input: { query?: Record<string, unknown> }) =>
    views[String(input.query?.view)] ?? page([]);

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

describe('Today (OP-01)', () => {
  it('shows the four tiles from the queue counts and the first things to do', async () => {
    answerWith(api.call, {
      'GET /admin/me': staff(READ),
      'GET /cases/queue/counts': counts,
      'GET /cases/queue': queueByView({
        mine: page([caseRow(1, { title: 'Proposal flagged', ownerUserId: ME, sla: sla('AT_RISK', 52) })]),
        escalated: page([caseRow(2, { title: 'Payout hold above 1M', state: 'ESCALATED' })]),
      }),
    });
    const { container } = renderWithQuery(<Today />);

    const tiles = await screen.findByRole('region', { name: 'Queue at a glance' });
    expect(within(tiles).getByText('Waiting for you')).toBeTruthy();
    expect(within(tiles).getByText('6')).toBeTruthy();
    expect(within(tiles).getByText('2 urgent')).toBeTruthy();
    expect(within(tiles).getByText('11')).toBeTruthy();
    expect(within(tiles).getByText('4')).toBeTruthy();

    const first = await screen.findByRole('table', { name: 'Do these first' });
    expect(within(first).getByText('Proposal flagged')).toBeTruthy();
    expect(within(first).getByText('52m')).toBeTruthy();
    const escalated = await screen.findByRole('table', { name: 'Escalated' });
    expect(within(escalated).getByText('Payout hold above 1M')).toBeTruthy();

    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says so when nothing is waiting', async () => {
    answerWith(api.call, {
      'GET /admin/me': staff(READ),
      'GET /cases/queue/counts': { mine: 0, mineUrgent: 0, unassigned: 0, escalated: 0, slaAtRisk: 0 },
      'GET /cases/queue': page([]),
    });
    renderWithQuery(<Today />);
    expect(await screen.findAllByText('Nothing waiting for you')).not.toHaveLength(0);
  });
});

describe('My work (OP-02)', () => {
  const rows = [
    caseRow(1, { type: 'TRADE_PROPOSAL', title: 'Proposal flagged', ownerUserId: ME }),
    caseRow(2, { type: 'DISPUTE', title: 'Item not as described', ownerUserId: ME }),
    caseRow(3, {
      type: 'CUSTODY',
      title: 'Return awaiting courier',
      ownerUserId: ME,
      sla: sla('BREACHED', -90),
    }),
  ];

  it('lists my cases with the area and the clock, and narrows by area chip', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(READ), 'GET /cases/queue': page(rows) });
    const { container } = renderWithQuery(<MyWork />);

    const table = await screen.findByRole('table', { name: 'My work' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('Overdue')).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);

    fireEvent.click(screen.getByRole('button', { name: 'Custody' }));
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    expect(within(table).getByText('Return awaiting courier')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Custody' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('asks the platform for the "mine" view', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(READ), 'GET /cases/queue': page(rows) });
    renderWithQuery(<MyWork />);
    await screen.findByRole('table', { name: 'My work' });
    const queueCall = callsTo(api.call, '/cases/queue')[0];
    expect(queueCall?.[1].query?.view).toBe('mine');
  });

  it('offers a retry when the list cannot load', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(READ) });
    renderWithQuery(<MyWork />);
    expect(await screen.findByText('We could not load this list')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('loads the next page on request', async () => {
    let calls = 0;
    answerWith(api.call, {
      'GET /admin/me': staff(READ),
      'GET /cases/queue': () => (calls++ === 0 ? page([rows[0]!], 'c1') : page([rows[1]!])),
    });
    renderWithQuery(<MyWork />);
    await screen.findByText('Proposal flagged');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Item not as described')).toBeTruthy();
  });
});

describe('Team queue (OP-03)', () => {
  const open = [caseRow(10, { title: 'First trade, new number' }), caseRow(11, { title: 'Appeal filed' })];

  it('lets a case manager take a case, then refreshes the list', async () => {
    let taken = false;
    answerWith(api.call, {
      'GET /admin/me': staff(MANAGE),
      'GET /cases/queue': () => page(taken ? [open[1]!] : open),
      'POST /cases/:id/take': () => {
        taken = true;
        return { ...open[0]!, ownerUserId: ME };
      },
    });
    renderWithQuery(<TeamQueue />);

    const table = await screen.findByRole('table', { name: 'Unassigned' });
    fireEvent.click(within(table).getAllByRole('button', { name: /Take/ })[0]!);
    await waitFor(() => expect(screen.queryByText('First trade, new number')).toBeNull());
    const take = callsTo(api.call, '/cases/:id/take')[0];
    expect(take?.[1]).toEqual({ params: { id: id(10) } });
  });

  it('shows no Take button to someone who can only read cases', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(READ), 'GET /cases/queue': page(open) });
    renderWithQuery(<TeamQueue />);
    await screen.findByRole('table', { name: 'Unassigned' });
    expect(screen.queryByRole('button', { name: /Take/ })).toBeNull();
  });

  it('reports a take that failed, for example because someone else got there first', async () => {
    answerWith(api.call, {
      'GET /admin/me': staff(MANAGE),
      'GET /cases/queue': page(open),
      'POST /cases/:id/take': () => {
        throw new Error('already taken');
      },
    });
    renderWithQuery(<TeamQueue />);
    const table = await screen.findByRole('table', { name: 'Unassigned' });
    fireEvent.click(within(table).getAllByRole('button', { name: /Take/ })[0]!);
    expect(await screen.findByText(/could not take/i)).toBeTruthy();
  });

  it('does not invent a capacity roster', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(READ), 'GET /cases/queue': page(open) });
    renderWithQuery(<TeamQueue />);
    await screen.findByRole('table', { name: 'Unassigned' });
    expect(screen.queryByText(/Who has capacity/)).toBeNull();
  });
});

describe('Alerts (OP-04)', () => {
  it('lists escalated cases and cases whose clock is at risk, and says what the queue flags', async () => {
    answerWith(api.call, {
      'GET /admin/me': staff(READ),
      'GET /cases/queue': queueByView({
        escalated: page([caseRow(20, { title: 'Return window lapsed', state: 'ESCALATED' })]),
        sla_at_risk: page([
          caseRow(21, { title: 'Hub reported an unsealed return', sla: sla('AT_RISK', 30) }),
        ]),
      }),
    });
    const { container } = renderWithQuery(<Alerts />);
    const escalated = await screen.findByRole('table', { name: 'Escalated' });
    expect(within(escalated).getByText('Return window lapsed')).toBeTruthy();
    const risk = await screen.findByRole('table', { name: 'Clock at risk' });
    expect(within(risk).getByText('Hub reported an unsealed return')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'How the queue flags work' })).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('Cases (OP-19)', () => {
  const list = [
    caseRow(30, { type: 'DISPUTE', title: 'Item not as described', ownerUserId: ME, state: 'INVESTIGATING' }),
    caseRow(31, { type: 'FRAUD', title: 'Unusual cancellations' }),
  ];

  it('lists every case with type, state, owner and clock', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(READ), 'GET /cases': page(list) });
    const { container } = renderWithQuery(<CasesList />);
    const table = await screen.findByRole('table', { name: 'Cases' });
    expect(within(table).getByText('Dispute')).toBeTruthy();
    expect(within(table).getByText('Investigating')).toBeTruthy();
    expect(within(table).getByText('You')).toBeTruthy();
    expect(within(table).getByText('Unassigned')).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('filters by type through the platform, and searches by case number', async () => {
    answerWith(api.call, { 'GET /admin/me': staff(READ), 'GET /cases': page(list) });
    renderWithQuery(<CasesList />);
    await screen.findByRole('table', { name: 'Cases' });

    fireEvent.click(screen.getByRole('button', { name: 'Risk' }));
    await waitFor(() => {
      const last = callsTo(api.call, '/cases').at(-1);
      expect(last?.[1].query?.type).toBe('FRAUD');
    });

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search by case number' }), {
      target: { value: 'C-000031' },
    });
    await waitFor(
      () => {
        const last = callsTo(api.call, '/cases').at(-1);
        expect(last?.[1].query?.q).toBe('C-000031');
      },
      { timeout: 2000 },
    );
  });
});
