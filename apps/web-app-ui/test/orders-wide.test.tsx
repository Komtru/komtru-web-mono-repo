// @vitest-environment jsdom
// F-069 / F-073 (DX-18, TX-11): the seller's orders as a table on a desktop and a list with a detail pane on a tablet.
// The data and the grouping are the phone's (`active-orders.test.tsx`); what is tested here is the arrangement.
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveOrders } from '../src/trade/ActiveOrders';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  counterparty,
  id,
  listItem,
  renderWithApi,
  type CallFn,
} from './support/trade';
import { setWidth } from './support/viewport';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const list = (items: unknown[]) => ({ items, nextCursor: null });
const order = (n: number, status: string, over: Record<string, unknown> = {}) =>
  listItem(n, { status, yourRole: 'SELLER', attention: null, awaiting: null, ...over });

const toShip = order(1, 'FUNDED', {
  attention: 'SHIP',
  tradeCode: 'KMT-8830100-NG',
  item: { title: 'MacBook Air M2', categoryCode: 'electronics', categoryName: 'Electronics' },
  itemAmountMinor: '98000000',
  counterparty: counterparty({ displayName: 'Amaka O.' }),
});
const moving = order(2, 'SHIPPED', {
  tradeCode: 'KMT-8819000-NG',
  item: { title: 'Galaxy Buds Pro', categoryCode: 'electronics', categoryName: 'Electronics' },
  itemAmountMinor: '8950000',
  counterparty: counterparty({ displayName: 'Tunde A.' }),
});
const inspecting = order(3, 'INSPECTION', { tradeCode: 'KMT-9030100-NG' });
const bought = listItem(5, { status: 'FUNDED', yourRole: 'BUYER', attention: null, awaiting: null });

describe('Orders at a desktop (DX-18)', () => {
  beforeEach(() => setWidth('desktop'));

  it('lists the seller’s orders in a table, with the buyer, item, amount, status and what is next', async () => {
    answerWith(api.call, { 'GET /trades': list([toShip, moving, inspecting, bought]) });
    const { container } = renderWithApi(api.call, <ActiveOrders />);
    const table = await screen.findByRole('table', { name: 'Orders' });
    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeTruthy();
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Trade', 'Buyer', 'Item', 'Amount', 'Status', 'Next step', 'Action']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('KMT-8830100-NG');
    expect(rows[0]?.textContent).toContain('Amaka O.');
    expect(rows[0]?.textContent).toContain('MacBook Air M2');
    expect(rows[0]?.textContent).toContain('₦980,000');
    expect(
      within(rows[0] as HTMLElement)
        .getByRole('link', { name: /Dispatch/ })
        .getAttribute('href'),
    ).toBe(`/trade/${id(1)}/dispatch`);
    expect(
      within(rows[1] as HTMLElement)
        .getByRole('link', { name: /Open/ })
        .getAttribute('href'),
    ).toBe(`/trade/${id(2)}`);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('counts the orders on the filter chips and narrows the table to the one chosen', async () => {
    answerWith(api.call, { 'GET /trades': list([toShip, moving, inspecting]) });
    renderWithApi(api.call, <ActiveOrders />);
    await screen.findByRole('table', { name: 'Orders' });
    const filters = screen.getByRole('group', { name: 'Filter orders' });
    expect(
      within(filters)
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual(['All (3)', 'Needs action (1)', 'Ready to ship (1)', 'In transit (1)', 'Inspecting (1)']);
    expect(within(filters).getByRole('button', { name: 'All (3)' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    fireEvent.click(within(filters).getByRole('button', { name: 'In transit (1)' }));
    const rows = within(screen.getByRole('table', { name: 'Orders' }))
      .getAllByRole('row')
      .slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('KMT-8819000-NG');
    expect(within(filters).getByRole('button', { name: 'In transit (1)' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('says there is nothing in a filter when it is empty, and keeps the chips so the person can go back', async () => {
    answerWith(api.call, { 'GET /trades': list([moving]) });
    renderWithApi(api.call, <ActiveOrders />);
    await screen.findByRole('table', { name: 'Orders' });
    fireEvent.click(screen.getByRole('button', { name: 'Ready to ship (0)' }));
    expect(screen.getByText('Nothing here right now.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All (1)' }));
    expect(screen.getByRole('table', { name: 'Orders' })).toBeTruthy();
  });

  it('keeps the empty state, with the wide heading, when there is nothing to fulfil', async () => {
    answerWith(api.call, { 'GET /trades': list([bought]) });
    renderWithApi(api.call, <ActiveOrders />);
    expect(await screen.findByText('No orders to fulfil')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('Orders at a tablet (TX-11)', () => {
  beforeEach(() => setWidth('tablet'));

  it('lists the orders beside a detail pane for the first, and moves the pane to the one chosen', async () => {
    answerWith(api.call, { 'GET /trades': list([toShip, moving]) });
    const { container } = renderWithApi(api.call, <ActiveOrders />);
    const listing = await screen.findByRole('list', { name: 'Orders' });
    expect(screen.queryByRole('table')).toBeNull();
    const pane = screen.getByRole('region', { name: 'Order detail' });
    expect(within(pane).getByRole('heading', { name: 'MacBook Air M2' })).toBeTruthy();
    expect(within(pane).getByText('Amaka O.')).toBeTruthy();
    expect(within(pane).getByText('₦980,000')).toBeTruthy();
    expect(within(pane).getByRole('link', { name: 'Dispatch' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/dispatch`,
    );

    fireEvent.click(within(listing).getByRole('button', { name: /Galaxy Buds Pro/ }));
    const next = screen.getByRole('region', { name: 'Order detail' });
    expect(within(next).getByRole('heading', { name: 'Galaxy Buds Pro' })).toBeTruthy();
    expect(within(next).getByRole('link', { name: 'Open the trade' }).getAttribute('href')).toBe(
      `/trade/${id(2)}`,
    );
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('filters by chip and moves the pane to what is left', async () => {
    answerWith(api.call, { 'GET /trades': list([toShip, moving]) });
    renderWithApi(api.call, <ActiveOrders />);
    await screen.findByRole('list', { name: 'Orders' });
    fireEvent.click(screen.getByRole('button', { name: 'In transit (1)' }));
    expect(within(screen.getByRole('list', { name: 'Orders' })).getAllByRole('listitem')).toHaveLength(1);
    expect(
      within(screen.getByRole('region', { name: 'Order detail' })).getByRole('heading', {
        name: 'Galaxy Buds Pro',
      }),
    ).toBeTruthy();
  });
});

describe('Orders on a phone', () => {
  it('stays the grouped list', async () => {
    setWidth('phone');
    answerWith(api.call, { 'GET /trades': list([toShip]) });
    renderWithApi(api.call, <ActiveOrders />);
    expect(await screen.findByRole('heading', { name: 'Ready to ship' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Active Orders' })).toBeTruthy();
  });
});
