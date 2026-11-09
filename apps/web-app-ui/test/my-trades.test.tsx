// @vitest-environment jsdom
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyTrades } from '../src/trade/MyTrades';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  callsTo,
  counterparty,
  id,
  listItem,
  renderWithApi,
  type CallFn,
} from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const list = (items: unknown[], nextCursor: string | null = null) => ({ items, nextCursor });

const held = listItem(1, {
  tradeCode: 'KMT-9013800-NG',
  yourRole: 'BUYER',
  status: 'UNDER_PROPOSAL_REVIEW',
  awaiting: null,
  attention: null,
  counterparty: counterparty({ displayName: 'Prime Gadgets', username: 'primegadgets' }),
  itemAmountMinor: '145000000',
  item: { title: 'Bluetooth Speaker', categoryCode: 'electronics', categoryName: 'Electronics' },
});
const waiting = listItem(2, { yourRole: 'BUYER', awaiting: 'COUNTERPARTY', attention: null });
const toAnswer = listItem(3);
const toPay = listItem(4, { status: 'PENDING_PAYMENT', attention: 'PAY', awaiting: null, yourRole: 'BUYER' });

describe('Your Trades (Q1)', () => {
  it('invites the first trade when there are none', async () => {
    answerWith(api.call, { 'GET /trades': list([]) });
    renderWithApi(api.call, <MyTrades />);
    expect(await screen.findByText('No protected trades yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start a trade' }).getAttribute('href')).toBe('/trade/new');
  });

  it('asks for the first page of every state, newest-relevant first as the platform orders it', async () => {
    answerWith(api.call, { 'GET /trades': list([held]) });
    renderWithApi(api.call, <MyTrades />);
    await screen.findByText('Verification Needed');
    expect(callsTo(api.call, 'GET', '/trades')[0]?.query).toEqual({ state: 'ALL', limit: 20 });
  });

  it("counts what needs attention from the server's `attention`, not from the status", async () => {
    answerWith(api.call, { 'GET /trades': list([held, waiting, toAnswer, toPay]) });
    const { container } = renderWithApi(api.call, <MyTrades />);

    // Two rows carry an attention kind; the held proposal and the sent one do not, whatever their status.
    expect(await screen.findByText('2 need your attention · 4 active')).toBeTruthy();
    const rows = screen
      .getAllByRole('link')
      .filter((link) => /^\/trade\/[0-9a-f-]{36}$/.test(link.getAttribute('href') ?? ''));
    expect(rows).toHaveLength(4);
    const heldRow = rows.find((row) => row.getAttribute('href') === `/trade/${id(1)}`) as HTMLElement;
    expect(within(heldRow).getByText('₦1,450,000')).toBeTruthy();
    expect(within(heldRow).getByText('Verification Needed').className).toContain('bg-info-soft');
    expect(within(heldRow).getByText('Prime Gadgets')).toBeTruthy();
    expect(
      within(heldRow).getByText(/Bluetooth Speaker · Proposal KMT-9013800-NG · held for review/),
    ).toBeTruthy();
    expect(heldRow.className).not.toContain('border-trust-indigo');

    const payRow = rows.find((row) => row.getAttribute('href') === `/trade/${id(4)}`) as HTMLElement;
    expect(within(payRow).getByText('Payment due')).toBeTruthy();
    expect(payRow.className).toContain('border-trust-indigo');
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('names a counterparty by handle when there is no display name, and draws none when there is none', async () => {
    answerWith(api.call, {
      'GET /trades': list([
        listItem(1, { counterparty: counterparty({ displayName: null }) }),
        listItem(2, { counterparty: null }),
        listItem(3, { counterparty: counterparty({ displayName: null, username: null }) }),
      ]),
    });
    renderWithApi(api.call, <MyTrades />);
    expect(await screen.findByText('@amaka')).toBeTruthy();
    expect(screen.getByText('A Komtru member')).toBeTruthy();
    expect(screen.queryByText('null')).toBeNull();
  });

  it('shows more with the cursor exactly as it came', async () => {
    answerWith(api.call, {
      'GET /trades': ({ query }: { query?: Record<string, unknown> }) =>
        query?.cursor === undefined ? list([toAnswer], 'a b+c/d==') : list([toPay], null),
    });
    renderWithApi(api.call, <MyTrades />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await screen.findByText('Payment due');
    expect(callsTo(api.call, 'GET', '/trades').map((call) => call.query?.cursor)).toEqual([
      undefined,
      'a b+c/d==',
    ]);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('starts again from page one when the platform refuses a cursor, and never resends that cursor', async () => {
    let first = true;
    answerWith(api.call, {
      'GET /trades': ({ query }: { query?: Record<string, unknown> }) => {
        if (query?.cursor !== undefined) {
          return new ProblemError(
            { type: 'about:blank', title: 't', status: 422, code: 'VALIDATION_FAILED' },
            {
              status: 422,
              requestId: undefined,
              replayed: false,
              retryAfterMs: undefined,
              rateLimit: undefined,
            },
            false,
          );
        }
        const page = first ? list([toAnswer], 'stale') : list([toPay], null);
        first = false;
        return page;
      },
    });
    renderWithApi(api.call, <MyTrades />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await screen.findByText('Payment due');
    expect(callsTo(api.call, 'GET', '/trades').filter((call) => call.query?.cursor === 'stale')).toHaveLength(
      1,
    );
  });

  it('shows the shape of the page while it loads, and a retry when it cannot be read', async () => {
    api.call.mockImplementation(() => new Promise(() => undefined));
    const first = renderWithApi(api.call, <MyTrades />);
    expect(screen.getByRole('status', { name: 'Loading your trades' })).toBeTruthy();
    first.unmount();

    answerWith(api.call, { 'GET /trades': new Error('offline') });
    renderWithApi(api.call, <MyTrades />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('says a row with no price has none rather than inventing one', async () => {
    answerWith(api.call, { 'GET /trades': list([listItem(1, { itemAmountMinor: null })]) });
    renderWithApi(api.call, <MyTrades />);
    await waitFor(() => {
      expect(screen.getByText('—')).toBeTruthy();
    });
  });
});
