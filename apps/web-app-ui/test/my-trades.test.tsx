// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyTrades } from '../src/trade/MyTrades';
import { rememberTrade } from '../src/trade/known-trades';
import { expectNoAxeViolations } from './axe';
import { SHELL_RULES, answerWith, id, renderWithApi, tradeView, type CallFn } from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
  window.localStorage.clear();
});
afterEach(cleanup);

const held = tradeView({
  id: id(1),
  tradeCode: 'KMT-90138',
  yourRole: 'BUYER',
  status: 'UNDER_PROPOSAL_REVIEW',
  awaiting: null,
  terms: {
    ...tradeView().terms,
    itemAmountMinor: '145000000',
    itemSpec: { brand: 'Bluetooth', model: 'Speaker' },
  },
});
const waiting = tradeView({ id: id(2), tradeCode: 'KMT-90428', yourRole: 'BUYER', awaiting: 'COUNTERPARTY' });
const toAnswer = tradeView({ id: id(3), tradeCode: 'KMT-90500' });

const byId = (views: ReturnType<typeof tradeView>[]) => ({
  'GET /trades/:id': ({ params }: { params?: Record<string, string> }) =>
    views.find((view) => view.id === params?.id),
});

describe('Your Trades (Q1)', () => {
  it('invites the first trade when there are none', () => {
    answerWith(api.call, {});
    renderWithApi(api.call, <MyTrades />);
    expect(screen.getByText('No protected trades yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start a trade' }).getAttribute('href')).toBe('/trade/new');
    expect(api.call).not.toHaveBeenCalled();
  });

  it('counts what needs attention and marks a held proposal Verification needed', async () => {
    for (const trade of [held, waiting, toAnswer]) rememberTrade(trade.id);
    answerWith(api.call, byId([held, waiting, toAnswer]));
    const { container } = renderWithApi(api.call, <MyTrades />);

    expect(await screen.findByText('2 need your attention · 3 active')).toBeTruthy();
    const rows = screen
      .getAllByRole('link')
      .filter((link) => /^\/trade\/[0-9a-f-]{36}$/.test(link.getAttribute('href') ?? ''));
    expect(rows).toHaveLength(3);
    const heldRow = rows.find((row) => row.getAttribute('href') === `/trade/${id(1)}`) as HTMLElement;
    expect(within(heldRow).getByText('₦1,450,000.00')).toBeTruthy();
    expect(within(heldRow).getByText('Verification needed').className).toContain('bg-info-soft');
    expect(within(heldRow).getByText(/Proposal KMT-90138 · held for review, not yet sent/)).toBeTruthy();
    // Q1 draws the row that needs the person with an indigo border; one that is only waiting has none.
    expect(heldRow.className).toContain('border-trust-indigo');
    const waitingRow = rows.find((row) => row.getAttribute('href') === `/trade/${id(2)}`) as HTMLElement;
    expect(waitingRow.className).not.toContain('border-trust-indigo');
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('keeps showing the trades it could read when one cannot be read, and says so', async () => {
    rememberTrade(id(1));
    rememberTrade(id(2));
    answerWith(api.call, {
      'GET /trades/:id': ({ params }: { params?: Record<string, string> }) =>
        params?.id === id(1) ? held : new Error('offline'),
    });
    renderWithApi(api.call, <MyTrades />);
    expect(await screen.findByText('Verification needed')).toBeTruthy();
    expect(await screen.findByText("1 trade couldn't be loaded. Reload to try again.")).toBeTruthy();
  });

  it('filters to a Trade Code from the search bar, and says when this device has no such trade', async () => {
    for (const trade of [held, waiting]) rememberTrade(trade.id);
    answerWith(api.call, byId([held, waiting]));
    const first = renderWithApi(api.call, <MyTrades code="kmt-90428" />);
    await screen.findByText(/Proposal KMT-90428/);
    expect(screen.queryByText(/KMT-90138/)).toBeNull();
    first.unmount();

    renderWithApi(api.call, <MyTrades code="KMT-1" />);
    expect(await screen.findByText(/No trade with the code KMT-1 on this device/)).toBeTruthy();
  });
});
