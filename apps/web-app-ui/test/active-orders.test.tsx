// @vitest-environment jsdom
// F-026 (AC8): the seller's orders by custody stage. The list is the platform's; the grouping is by status and the
// reader's side of the trade, and nothing is worked out beyond that.
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveOrders } from '../src/trade/ActiveOrders';
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
const order = (n: number, status: string, over: Record<string, unknown> = {}) =>
  listItem(n, { status, yourRole: 'SELLER', attention: null, awaiting: null, ...over });

const toShip = order(1, 'FUNDED', {
  attention: 'SHIP',
  tradeCode: 'KMT-8821300-NG',
  itemAmountMinor: '45200000',
  counterparty: counterparty({ displayName: 'Amaka B.' }),
});
const moving = order(2, 'SHIPPED', {
  tradeCode: 'KMT-8830100-NG',
  item: { title: 'MacBook Air M2', categoryCode: 'electronics', categoryName: 'Electronics' },
  itemAmountMinor: '98000000',
});
const delivered = order(3, 'UNCONFIRMED_DELIVERY', { tradeCode: 'KMT-9030100-NG' });
const inspecting = order(4, 'INSPECTION', { tradeCode: 'KMT-8819000-NG' });
const bought = listItem(5, { status: 'FUNDED', yourRole: 'BUYER', attention: null, awaiting: null });
const proposal = order(6, 'AWAITING_ACCEPTANCE', { attention: 'RESPOND_TO_PROPOSAL' });

describe('Active Orders (AC8)', () => {
  it('asks for the open trades and groups the seller’s by custody stage, in order', async () => {
    answerWith(api.call, { 'GET /trades': list([toShip, moving, delivered, inspecting]) });
    const { container } = renderWithApi(api.call, <ActiveOrders />);
    await screen.findByRole('heading', { name: 'Ready to ship' });
    expect(callsTo(api.call, 'GET', '/trades')[0]?.query).toEqual({ state: 'OPEN', limit: 20 });
    expect(screen.getByRole('heading', { level: 1, name: 'Active Orders' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Ready to ship1',
      'In transit2',
      'Awaiting buyer inspection1',
    ]);
    const ready = screen.getByRole('list', { name: 'Ready to ship' });
    expect(within(ready).getByText('₦452,000')).toBeTruthy();
    const transit = screen.getByRole('list', { name: 'In transit' });
    expect(within(transit).getAllByRole('link')).toHaveLength(2);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('takes a trade to ship straight to the ship screen and the rest to the trade', async () => {
    answerWith(api.call, { 'GET /trades': list([toShip, moving]) });
    renderWithApi(api.call, <ActiveOrders />);
    await screen.findByRole('heading', { name: 'Ready to ship' });
    const ready = within(screen.getByRole('list', { name: 'Ready to ship' })).getByRole('link');
    expect(ready.getAttribute('href')).toBe(`/trade/${id(1)}/dispatch`);
    const transit = within(screen.getByRole('list', { name: 'In transit' })).getByRole('link');
    expect(transit.getAttribute('href')).toBe(`/trade/${id(2)}`);
  });

  it('leaves out what the person is buying and proposals still being agreed, and a stage with nothing in it', async () => {
    answerWith(api.call, { 'GET /trades': list([bought, proposal, moving]) });
    renderWithApi(api.call, <ActiveOrders />);
    await screen.findByRole('heading', { name: 'In transit' });
    expect(screen.queryByRole('heading', { name: 'Ready to ship' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Awaiting buyer inspection' })).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('keeps its heading and says there is nothing to fulfil yet, with no buyer-side link', async () => {
    answerWith(api.call, { 'GET /trades': list([bought]) });
    renderWithApi(api.call, <ActiveOrders />);
    expect(await screen.findByText('No orders to fulfil')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Active Orders' })).toBeTruthy();
    expect(screen.getByText(/funds a trade with you/)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says some orders did not load when a later page fails, keeps what it has, and can try again', async () => {
    let tries = 0;
    answerWith(api.call, {
      'GET /trades': ({ query }: { query?: Record<string, unknown> }) => {
        if (query?.cursor === undefined) return list([toShip], 'c2');
        tries += 1;
        if (tries === 1) throw new Error('offline');
        return list([moving]);
      },
    });
    renderWithApi(api.call, <ActiveOrders />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Some orders didn’t load');
    expect(screen.getByRole('heading', { name: 'Ready to ship' })).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'In transit' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reads on through every page, so an order on a later page is not missed', async () => {
    answerWith(api.call, {
      'GET /trades': ({ query }: { query?: Record<string, unknown> }) =>
        query?.cursor === undefined ? list([bought], 'c2') : list([toShip]),
    });
    renderWithApi(api.call, <ActiveOrders />);
    expect(await screen.findByRole('heading', { name: 'Ready to ship' })).toBeTruthy();
    expect(callsTo(api.call, 'GET', '/trades').map((call) => call.query?.cursor)).toEqual([undefined, 'c2']);
  });

  it('says so and lets the person try again when the orders cannot be read', async () => {
    let attempt = 0;
    answerWith(api.call, {
      'GET /trades': () => {
        attempt += 1;
        if (attempt === 1) throw new Error('offline');
        return list([toShip]);
      },
    });
    renderWithApi(api.call, <ActiveOrders />);
    expect(await screen.findByText('Couldn’t load your orders')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByRole('heading', { name: 'Ready to ship' })).toBeTruthy();
  });
});
