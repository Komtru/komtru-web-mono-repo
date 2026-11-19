// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradeScreen } from '../src/trade/TradeScreen';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  callsTo,
  deliveryDeadline,
  fileRead,
  id,
  inspectionRead,
  listItem,
  page,
  renderWithApi,
  workspaceTrade,
  type CallFn,
} from './support/workspace';
import { atWidth, unwidth, type Width } from './support/viewport';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(() => {
  cleanup();
  unwidth();
});

const trades = [
  listItem(1, { status: 'SHIPPED', yourRole: 'BUYER', attention: null, awaiting: null }),
  listItem(2, {
    status: 'PENDING_PAYMENT',
    yourRole: 'BUYER',
    attention: 'PAY',
    awaiting: 'YOU',
    itemAmountMinor: '8950000',
  }),
  listItem(3, { status: 'SETTLED', yourRole: 'BUYER', attention: null, awaiting: null }),
];

const serve = (view: unknown, more: Record<string, unknown> = {}) =>
  answerWith(api.call, {
    'GET /trades/:id': view,
    'GET /trades/:id/delivery-deadline': deliveryDeadline(),
    'GET /trades/:id/inspection': inspectionRead(),
    'GET /trades/:id/activity': page([]),
    'GET /trades': page(trades),
    'GET /files/:id': fileRead(7),
    ...more,
  });

const show = (width: Width, status = 'SHIPPED', role: 'BUYER' | 'SELLER' = 'BUYER') => {
  atWidth(width);
  serve(workspaceTrade(status, role));
  return renderWithApi(api.call, <TradeScreen id={id(1)} />);
};

describe('the trade workspace on a tablet (TX-13)', () => {
  it('lists the trades beside the open one, which is marked, and filters to the ones that need you', async () => {
    show('tablet');
    const list = await screen.findByRole('complementary', { name: 'Your trades' });
    const open = await within(list).findByText('₦452,000');
    expect(open.closest('li')?.getAttribute('aria-current')).toBe('true');
    // The default filter is the open trades, and the settled one is not among them.
    expect(within(list).queryByText('Complete')).toBeNull();
    expect(within(list).getByText('₦89,500')).toBeTruthy();

    fireEvent.click(within(list).getByRole('button', { name: 'Needs action' }));
    expect(within(list).queryByText('₦452,000')).toBeNull();
    expect(within(list).getByText('₦89,500')).toBeTruthy();

    fireEvent.click(within(list).getByRole('button', { name: 'Completed' }));
    expect(await within(list).findByText('Complete')).toBeTruthy();
  });

  it('draws the money once, in the context panels under the detail, with the evidence and its way in', async () => {
    show('tablet');
    const rail = await screen.findByRole('complementary', { name: 'Trade context' });
    expect(within(rail).getByText('Seller payout')).toBeTruthy();
    expect(within(rail).getByText('₦458,780')).toBeTruthy();
    expect(within(rail).getByRole('link', { name: 'View all' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/evidence`,
    );
    await waitFor(() => expect(within(rail).getAllByRole('img').length).toBeGreaterThan(0));
    // No timeline at a tablet: the summary card's bar and the next action stay together, as TX-13 draws it.
    expect(screen.queryByRole('list', { name: 'Where the trade is' })).toBeNull();
  });

  it('does not draw the money twice in a state whose own body has money rows', async () => {
    show('tablet', 'FUNDED');
    await screen.findByRole('complementary', { name: 'Trade context' });
    expect(screen.getAllByText('Seller payout')).toHaveLength(1);
  });

  it('keeps the same tabs and the one h1', async () => {
    show('tablet');
    await screen.findByRole('heading', { level: 1, name: 'KMT-9042800-NG' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Trade views' })).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    const { container } = show('tablet');
    await screen.findByRole('complementary', { name: 'Trade context' });
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('the trade workspace on a desktop (DX-21)', () => {
  it('puts the five stages in the detail and the money and evidence in a rail of their own', async () => {
    show('desktop');
    const stages = await screen.findByRole('list', { name: 'Where the trade is' });
    const steps = within(stages).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual([
      expect.stringContaining('Agreement accepted'),
      expect.stringContaining('Funds protected'),
      expect.stringContaining('Shipped'),
      expect.stringContaining('Inspection'),
      expect.stringContaining('Release'),
    ]);
    expect(within(steps[2] as HTMLElement).getByText('Now')).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Your trades' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Trade context' })).toBeTruthy();
  });

  it('says what each side is owed: the seller sees their payout, not the buyer’s total', async () => {
    show('desktop', 'SHIPPED', 'SELLER');
    const rail = await screen.findByRole('complementary', { name: 'Trade context' });
    expect(within(rail).getByText('Your payout')).toBeTruthy();
    expect(within(rail).queryByText('Total')).toBeNull();
  });

  it('says evidence is not there yet before the item has shipped, without reading for it', async () => {
    show('desktop', 'FUNDED');
    const rail = await screen.findByRole('complementary', { name: 'Trade context' });
    expect(within(rail).getByText('Evidence appears here once the item has shipped.')).toBeTruthy();
    expect(callsTo(api.call, 'GET', '/trades/:id/inspection')).toHaveLength(0);
  });

  it('has no accessibility violations', async () => {
    const { container } = show('desktop');
    await screen.findByRole('list', { name: 'Where the trade is' });
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('the trade workspace on a phone', () => {
  it('is the screen it was: no list, no rail, and the trade list is never read', async () => {
    show('mobile');
    await screen.findByRole('heading', { level: 1, name: 'KMT-9042800-NG' });
    expect(screen.queryByRole('complementary', { name: 'Your trades' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Trade context' })).toBeNull();
    expect(callsTo(api.call, 'GET', '/trades')).toHaveLength(0);
  });
});
