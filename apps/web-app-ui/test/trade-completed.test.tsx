// @vitest-environment jsdom
// F-069 (DX-31): trade complete. The result, what was agreed and done, and what it added to the person's record. The
// review form is F-038's and deferred, so the screen carries no form and says reviews are not open.
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradeCompleted } from '../src/trade/complete/TradeCompleted';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  callsTo,
  counterparty,
  id,
  listItem,
  renderWithApi,
  workspaceTrade,
  type CallFn,
} from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const list = (items: unknown[], nextCursor: string | null = null) => ({ items, nextCursor });
const closed = (n: number, status: string, categoryCode = 'electronics') =>
  listItem(n, {
    status,
    attention: null,
    awaiting: null,
    item: {
      title: 'Item',
      categoryCode,
      categoryName: categoryCode === 'electronics' ? 'Electronics' : 'Fashion',
    },
  });

const serve = (trade: unknown, closedTrades: unknown[] = []) =>
  answerWith(api.call, { 'GET /trades/:id': trade, 'GET /trades': list(closedTrades) });

describe('Trade complete (DX-31)', () => {
  it('tells the buyer the payment was released, to whom and how much, with the record of what was done', async () => {
    serve(
      workspaceTrade('SETTLED', 'BUYER', { counterparty: counterparty({ displayName: 'TechEdge NG' }) }),
      [closed(2, 'SETTLED'), closed(3, 'SETTLED'), closed(4, 'SETTLED', 'fashion'), closed(5, 'CANCELLED')],
    );
    const { container } = renderWithApi(api.call, <TradeCompleted id={id(1)} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Trade completed' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Payment released' })).toBeTruthy();
    expect(
      screen.getByText(/₦452,000 released to TechEdge NG\. Both sides honoured the agreement in full\./),
    ).toBeTruthy();

    const summary = screen.getByLabelText('Summary');
    expect(within(summary).getByText('KMT-9042800-NG')).toBeTruthy();
    expect(within(summary).getByText('Apple iPhone 13 Pro')).toBeTruthy();

    const record = screen.getByRole('list', { name: 'What was done' });
    expect(
      within(record)
        .getAllByRole('listitem')
        .map((step) => step.textContent),
    ).toEqual([
      'AgreementVersion 2',
      'Funds protectedHeld until you confirmed',
      'Delivered and inspectedConfirmed by you',
      'Payment releasedDone',
    ]);

    expect(await screen.findByText('3')).toBeTruthy();
    expect(screen.getByText('Electronics')).toBeTruthy();
    expect(screen.getByText('2 trades')).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('tells the seller what was released to them, and what they did', async () => {
    serve(workspaceTrade('SETTLED', 'SELLER'));
    renderWithApi(api.call, <TradeCompleted id={id(1)} />);
    expect(await screen.findByText(/₦452,000 released to you\./)).toBeTruthy();
    expect(screen.getByText('Confirmed by the buyer')).toBeTruthy();
  });

  it('says the payment is still being carried out while the trade is only completed', async () => {
    serve(workspaceTrade('COMPLETED', 'SELLER'));
    renderWithApi(api.call, <TradeCompleted id={id(1)} />);
    expect(await screen.findByText('Settlement is processing')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Payment released' })).toBeNull();
    expect(screen.getByText('Processing')).toBeTruthy();
  });

  it('has no review form and says reviews are not open yet', async () => {
    serve(workspaceTrade('SETTLED', 'BUYER'));
    const { container } = renderWithApi(api.call, <TradeCompleted id={id(1)} />);
    const review = await screen.findByRole('region', { name: 'Leave a review' });
    expect(within(review).getByText(/Reviews aren’t open yet/)).toBeTruthy();
    expect(container.querySelector('textarea')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit review' })).toBeNull();
  });

  it('keeps the record quiet rather than wrong when the closed trades cannot be read', async () => {
    answerWith(api.call, {
      'GET /trades/:id': workspaceTrade('SETTLED', 'BUYER'),
      'GET /trades': new Error('offline'),
    });
    renderWithApi(api.call, <TradeCompleted id={id(1)} />);
    expect(await screen.findByRole('heading', { name: 'Payment released' })).toBeTruthy();
    expect(await screen.findByText('Your record couldn’t load.')).toBeTruthy();
  });

  it('reads every page of the closed trades before counting them', async () => {
    answerWith(api.call, {
      'GET /trades/:id': workspaceTrade('SETTLED', 'BUYER'),
      'GET /trades': ({ query }: { query?: Record<string, unknown> }) =>
        query?.cursor === undefined ? list([closed(2, 'SETTLED')], 'c2') : list([closed(3, 'SETTLED')]),
    });
    renderWithApi(api.call, <TradeCompleted id={id(1)} />);
    expect(await screen.findByText('2')).toBeTruthy();
    expect(callsTo(api.call, 'GET', '/trades').map((call) => call.query?.state)).toEqual([
      'CLOSED',
      'CLOSED',
    ]);
  });

  it('refuses a trade that is not complete, with the way back to it', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'));
    renderWithApi(api.call, <TradeCompleted id={id(1)} />);
    expect(await screen.findByText('This trade isn’t complete yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the trade' }).getAttribute('href')).toBe(
      `/trade/${id(1)}`,
    );
    expect(screen.queryByRole('heading', { name: 'Payment released' })).toBeNull();
    expect(callsTo(api.call, 'GET', '/trades')).toHaveLength(0);
  });

  it('says so, with a retry, when the trade cannot be read', async () => {
    answerWith(api.call, { 'GET /trades/:id': new Error('offline') });
    renderWithApi(api.call, <TradeCompleted id={id(1)} />);
    expect(await screen.findByText('Couldn’t open this trade')).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});
