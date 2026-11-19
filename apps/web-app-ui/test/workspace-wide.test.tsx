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
import { atWidth, panelOf, resizeTo, unwidth, type Width } from './support/viewport';

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

  it('draws the money once, ahead of the actions it belongs with, and the seller’s proof with its way in', async () => {
    show('tablet');
    const money = panelOf(await screen.findByRole('heading', { name: 'Money' }));
    expect(within(money).getByText('Seller payout')).toBeTruthy();
    expect(within(money).getByText('₦458,780')).toBeTruthy();
    // Read before the action under it, not at the foot of the whole screen.
    const confirm = await screen.findByRole('button', { name: 'Confirm you have it' });
    expect(money.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const proof = panelOf(screen.getByRole('heading', { name: 'Seller’s proof' }));
    expect(within(proof).getByRole('link', { name: 'View all evidence' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/evidence`,
    );
    await waitFor(() => expect(within(proof).getAllByRole('img').length).toBeGreaterThan(0));
    // No timeline at a tablet: the summary card's bar and the next action stay together, as TX-13 draws it.
    expect(screen.queryByRole('list', { name: 'Where the trade is' })).toBeNull();
  });

  it('keeps the seller’s money above Ship this order', async () => {
    show('tablet', 'FUNDED', 'SELLER');
    const money = panelOf(await screen.findByRole('heading', { name: 'Money' }));
    const ship = await screen.findByRole('link', { name: 'Ship this order' });
    expect(money.compareDocumentPosition(ship) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not draw the money twice in a state whose own body has money rows', async () => {
    show('tablet', 'FUNDED');
    await screen.findByRole('heading', { name: 'Money' });
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
    await screen.findByRole('heading', { name: 'Money' });
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
    expect(screen.getByRole('heading', { name: 'Money' })).toBeTruthy();
  });

  it('says what each side is owed: the seller sees their payout, not the buyer’s total', async () => {
    show('desktop', 'SHIPPED', 'SELLER');
    const rail = panelOf(await screen.findByRole('heading', { name: 'Money' }));
    expect(within(rail).getByText('Your payout')).toBeTruthy();
    expect(within(rail).queryByText('Total')).toBeNull();
  });

  it('says evidence is not there yet before the item has shipped, without reading for it', async () => {
    show('desktop', 'FUNDED');
    const rail = panelOf(await screen.findByRole('heading', { name: 'Seller’s proof' }));
    expect(within(rail).getByText('The seller’s proof appears here once the item has shipped.')).toBeTruthy();
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
    expect(screen.queryByRole('heading', { name: 'Money' })).toBeNull();
    expect(callsTo(api.call, 'GET', '/trades')).toHaveLength(0);
  });
});

describe('what the money panel says in each state', () => {
  const rows = (status: string, role: 'BUYER' | 'SELLER', width: Width) => {
    show(width, status, role);
    return screen.findByRole('heading', { level: 1, name: 'KMT-9042800-NG' });
  };

  it.each(['tablet', 'desktop'] as const)(
    'tells the buyer what they paid and that the seller’s payout is held, while funded (%s)',
    async (width) => {
      await rows('FUNDED', 'BUYER', width);
      const money = panelOf(await screen.findByRole('heading', { name: 'Money' }));
      expect(within(money).getByText('You paid')).toBeTruthy();
      expect(within(money).getByText('₦458,780')).toBeTruthy();
      expect(within(money).getByText('held, not yet released')).toBeTruthy();
    },
  );

  it.each(['tablet', 'desktop'] as const)(
    'tells the seller the funds are confirmed and what they will receive, while funded (%s)',
    async (width) => {
      await rows('FUNDED', 'SELLER', width);
      const money = panelOf(await screen.findByRole('heading', { name: 'Money' }));
      expect(within(money).getByText('Confirmed · ₦452,000')).toBeTruthy();
      expect(within(money).getByText('₦452,000 · held, not yet released')).toBeTruthy();
    },
  );

  it.each(['BUYER', 'SELLER'] as const)(
    'says the money stays held while the case is open (%s, F-032)',
    async (role) => {
      await rows('DISPUTED', role, 'desktop');
      const money = panelOf(await screen.findByRole('heading', { name: 'Money' }));
      expect(within(money).getByText(/held while the case is open/)).toBeTruthy();
      expect(screen.getAllByText(/held while the case is open/).length).toBeGreaterThan(0);
      // The case itself is unchanged: its own reads and the way into it are the body's.
      expect(screen.getAllByText('Money')).toHaveLength(1);
    },
  );

  it.each([['PENDING_PAYMENT'], ['RESOLVED_REFUNDED'], ['CANCELLED_REFUNDED'], ['COMPLETED'], ['SETTLED']])(
    'draws no money panel in %s, where no figure is held for the reader',
    async (status) => {
      for (const role of ['BUYER', 'SELLER'] as const) {
        for (const width of ['tablet', 'desktop'] as const) {
          const { unmount } = show(width, status, role);
          await screen.findByRole('heading', { level: 1, name: 'KMT-9042800-NG' });
          await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
          expect(screen.queryByRole('heading', { name: 'Money' })).toBeNull();
          unmount();
          unwidth();
        }
      }
    },
  );
});

describe('a change of width while the trade is open', () => {
  it('re-arranges what is on screen instead of unmounting it', async () => {
    show('desktop', 'FUNDED');
    const tabs = await screen.findByRole('navigation', { name: 'Trade views' });
    const heading = screen.getByRole('heading', { level: 1, name: 'KMT-9042800-NG' });
    for (const width of ['tablet', 'mobile', 'desktop'] as const) {
      resizeTo(width);
      await waitFor(() =>
        expect(document.querySelector(`[data-workspace="${width}"]`) !== null || width === 'mobile').toBe(
          true,
        ),
      );
      expect(screen.getByRole('navigation', { name: 'Trade views' })).toBe(tabs);
      expect(screen.getByRole('heading', { level: 1, name: 'KMT-9042800-NG' })).toBe(heading);
    }
  });
});

describe('the trade list', () => {
  const several = (items: unknown[], more: unknown[]) =>
    answerWith(api.call, {
      'GET /trades/:id': workspaceTrade('SHIPPED', 'BUYER'),
      'GET /trades/:id/delivery-deadline': deliveryDeadline(),
      'GET /trades/:id/inspection': inspectionRead(),
      'GET /trades/:id/activity': page([]),
      'GET /files/:id': fileRead(7),
      'GET /trades': (input: { query?: Record<string, unknown> }) =>
        input.query?.cursor === undefined ? { items, nextCursor: 'next' } : { items: more, nextCursor: null },
    });

  it('reads on until the open trade is in it, so the pane marks the trade being read', async () => {
    atWidth('desktop');
    several([trades[1], trades[2]], [trades[0]]);
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    const list = await screen.findByRole('complementary', { name: 'Your trades' });
    const open = await within(list).findByText('₦452,000');
    expect(open.closest('li')?.getAttribute('aria-current')).toBe('true');
  });

  it('offers to load more when a filter shows nothing and the list goes on', async () => {
    atWidth('tablet');
    several([trades[0]], [trades[1]]);
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    const list = await screen.findByRole('complementary', { name: 'Your trades' });
    await within(list).findByText('₦452,000');
    fireEvent.click(within(list).getByRole('button', { name: 'Needs action' }));
    expect(within(list).getByText('No trades here.')).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: 'Load more' }));
    expect(await within(list).findByText('₦89,500')).toBeTruthy();
  });

  it('ties each filter to the list it filters', async () => {
    show('tablet');
    const list = await screen.findByRole('complementary', { name: 'Your trades' });
    const filter = within(list).getByRole('button', { name: 'Active' });
    expect(document.getElementById(filter.getAttribute('aria-controls') ?? '')).not.toBeNull();
  });
});

describe('the way to the result of a finished trade (DX-31)', () => {
  it.each(['COMPLETED', 'SETTLED'])('links a %s trade to its result', async (status) => {
    serve(workspaceTrade(status, 'BUYER'));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    const link = await screen.findByRole('link', { name: 'View the result' });
    expect(link.getAttribute('href')).toBe(`/trade/${id(1)}/completed`);
  });

  it('does not offer it before the outcome is known', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await screen.findByRole('heading', { level: 1, name: 'KMT-9042800-NG' });
    expect(screen.queryByRole('link', { name: 'View the result' })).toBeNull();
  });
});
