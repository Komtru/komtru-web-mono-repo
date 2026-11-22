// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeScreen } from '../src/home/HomeScreen';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  callsTo,
  counterparty,
  id,
  listItem as anyListItem,
  renderWithApi,
  type CallFn,
} from './support/trade';

// F-083: Buy's lists show only the trades the person is buying, so these rows are the buyer's unless a test says
// otherwise.
const listItem = (...[n, overrides]: Parameters<typeof anyListItem>): ReturnType<typeof anyListItem> =>
  anyListItem(n, { yourRole: 'BUYER', ...overrides });

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const page = (items: unknown[], nextCursor: string | null = null) => ({ items, nextCursor });

const needsAnswer = listItem(1, { counterparty: counterparty({ displayName: 'Amaka B.' }) });
const paying = listItem(2, {
  status: 'PENDING_PAYMENT',
  attention: null,
  awaiting: null,
  item: { title: 'Bluetooth Speaker', categoryCode: 'electronics', categoryName: 'Electronics' },
});
const cancelled = listItem(3, { status: 'CANCELLED', attention: null, awaiting: null });

const hrefOf = (n: number) => `/trade/${id(n)}`;

describe('Home with no trades yet (AC1, H-03)', () => {
  it('says what the product is for, and offers the two ways in beneath the panel', async () => {
    answerWith(api.call, { 'GET /trades': page([]) });
    const { container } = renderWithApi(api.call, <HomeScreen />);

    expect(await screen.findByRole('heading', { name: 'No protected Trades yet' })).toBeTruthy();
    expect(
      screen.getByText(
        'Start one, or enter a Trade Code from a seller — every completed Trade adds to your Trust Profile.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start a Trade' }).getAttribute('href')).toBe('/trade/new');
    expect(screen.getByRole('link', { name: 'Enter a Trade Code' }).getAttribute('href')).toBe('/find');
    expect(
      screen.getByText(
        'Agree on the details. Follow the payment and delivery status. Confirm the outcome when your obligations are met.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Your trades will appear here')).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('asks for every trade, not only the first page, before it decides there are none', async () => {
    answerWith(api.call, {
      'GET /trades': ({ query }: { query?: Record<string, unknown> }) =>
        query?.cursor === undefined ? page([], 'more') : page([], null),
    });
    renderWithApi(api.call, <HomeScreen />);
    expect(await screen.findByRole('heading', { name: 'No protected Trades yet' })).toBeTruthy();
    expect(callsTo(api.call, 'GET', '/trades')).toHaveLength(2);
  });
});

describe('Home when the first page is empty but more is unread', () => {
  it('does not claim there are no trades when the next page fails, and offers a retry', async () => {
    let later = 0;
    answerWith(api.call, {
      'GET /trades': ({ query }: { query?: Record<string, unknown> }) => {
        if (query?.cursor === undefined) return page([], 'c2');
        later += 1;
        return later === 1 ? new Error('offline') : page([], null);
      },
    });
    renderWithApi(api.call, <HomeScreen />);
    expect(await screen.findByRole('heading', { name: "Couldn't load your trades" })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'No protected Trades yet' })).toBeNull();
    expect(screen.queryByText('1 needs your attention · 0 active')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'No protected Trades yet' })).toBeTruthy();
  });

  it('keeps reading, and does not call it empty, while the next page is still on its way', async () => {
    api.call.mockImplementation((_endpoint, input) => {
      const cursor = input?.query?.cursor;
      return cursor === undefined ? Promise.resolve(page([], 'c2')) : new Promise(() => undefined);
    });
    renderWithApi(api.call, <HomeScreen />);
    expect(await screen.findByRole('status', { name: 'Loading your trades' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'No protected Trades yet' })).toBeNull();
  });
});

describe('Home with trades (Z1, H-01, Customer-1)', () => {
  beforeEach(() => {
    answerWith(api.call, { 'GET /trades': page([needsAnswer, paying, cancelled]) });
  });

  it('counts what needs the person and what is still moving', async () => {
    renderWithApi(api.call, <HomeScreen />);
    expect(await screen.findByText('1 needs your attention · 1 active')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your trades, at a glance' })).toBeTruthy();
  });

  it('groups trades into needs your attention, active and past, each row linking to its trade', async () => {
    renderWithApi(api.call, <HomeScreen />);
    const attention = await screen.findByRole('region', { name: 'Needs your attention' });
    const active = screen.getByRole('region', { name: 'Active trades' });
    const past = screen.getByRole('region', { name: 'Past trades' });

    expect(
      within(attention)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([hrefOf(1)]);
    expect(
      within(active)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([hrefOf(2)]);
    expect(
      within(past)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([hrefOf(3)]);
    expect(within(past).getByText('Cancelled')).toBeTruthy();
    expect(within(active).getByText('Terms agreed')).toBeTruthy();
  });

  it('outlines only the trades that need the person', async () => {
    renderWithApi(api.call, <HomeScreen />);
    await screen.findByRole('region', { name: 'Needs your attention' });
    const link = (n: number) =>
      screen.getAllByRole('link').find((el) => el.getAttribute('href') === hrefOf(n)) as HTMLElement;
    expect(link(1).className).toContain('border-trust-indigo');
    expect(link(2).className).not.toContain('border-trust-indigo');
  });

  it('offers the quick actions a person with trades needs', async () => {
    renderWithApi(api.call, <HomeScreen />);
    await screen.findByRole('region', { name: 'Needs your attention' });
    const actions = screen.getByRole('navigation', { name: 'Quick actions' });
    expect(within(actions).getByRole('link', { name: 'Find a Trade' }).getAttribute('href')).toBe('/find');
    expect(within(actions).getByRole('link', { name: 'Start a Trade' }).getAttribute('href')).toBe(
      '/trade/new',
    );
    expect(within(actions).getByRole('link', { name: 'Search' }).getAttribute('href')).toBe('/search');
    expect(screen.getByRole('link', { name: 'View all trades' }).getAttribute('href')).toBe('/trades');
  });

  it('draws the names of the other party and the item, as the Trades tab does', async () => {
    renderWithApi(api.call, <HomeScreen />);
    await screen.findByRole('region', { name: 'Needs your attention' });
    expect(
      within(await screen.findByRole('region', { name: 'Needs your attention' })).getByText('Amaka B.'),
    ).toBeTruthy();
    expect(
      screen.getByText(/^Bluetooth Speaker · Proposal KMT-\d+-NG · agreed, waiting for payment$/),
    ).toBeTruthy();
  });

  it('shows at most five past trades and points at the full list for the rest', async () => {
    const many = [1, 2, 3, 4, 5, 6, 7].map((n) => listItem(10 + n, { status: 'CANCELLED', attention: null }));
    answerWith(api.call, { 'GET /trades': page(many) });
    renderWithApi(api.call, <HomeScreen />);
    const past = await screen.findByRole('region', { name: 'Past trades' });
    expect(within(past).getAllByRole('link', { name: /Proposal/ })).toHaveLength(5);
    expect(within(past).getByText('(7)')).toBeTruthy();
    expect(within(past).getByRole('link', { name: 'See all trades' }).getAttribute('href')).toBe('/trades');
  });

  it('passes the accessibility check', async () => {
    const { container } = renderWithApi(api.call, <HomeScreen />);
    await screen.findByRole('region', { name: 'Needs your attention' });
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('Home while it loads and when it cannot', () => {
  it('shows the shape of the page while the list is read', () => {
    api.call.mockImplementation(() => new Promise(() => undefined));
    renderWithApi(api.call, <HomeScreen />);
    expect(screen.getByRole('status', { name: 'Loading your trades' })).toBeTruthy();
  });

  it('offers a retry when the first page cannot be read, and shows the trades once it can', async () => {
    let calls = 0;
    answerWith(api.call, {
      'GET /trades': () => {
        calls += 1;
        return calls === 1 ? new Error('offline') : page([needsAnswer]);
      },
    });
    renderWithApi(api.call, <HomeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('1 needs your attention · 0 active')).toBeTruthy();
  });

  it('keeps the trades it has and offers a retry when a later page fails', async () => {
    let later = 0;
    answerWith(api.call, {
      'GET /trades': ({ query }: { query?: Record<string, unknown> }) => {
        if (query?.cursor === undefined) return page([needsAnswer], 'c2');
        later += 1;
        return later === 1 ? new Error('offline') : page([paying], null);
      },
    });
    renderWithApi(api.call, <HomeScreen />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Amaka B\./ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Active trades' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// F-083: Buy's Home and Sell's Shop are two dashboards over one list, split by the side the person is on.
describe('the Buy and Sell dashboards', () => {
  const sale = listItem(40, {
    yourRole: 'SELLER',
    status: 'FUNDED',
    attention: 'SHIP',
    awaiting: null,
    item: { title: 'MacBook Air', categoryCode: 'electronics', categoryName: 'Electronics' },
  });
  const purchase = listItem(41, {
    item: { title: 'Ankara fabric', categoryCode: 'fashion', categoryName: 'Fashion' },
  });

  it('lists only what the person is buying on Home', async () => {
    answerWith(api.call, { 'GET /trades': page([sale, purchase]) });
    renderWithApi(api.call, <HomeScreen />);
    expect(await screen.findByText(/Ankara fabric/)).toBeTruthy();
    expect(screen.queryByText(/MacBook Air/)).toBeNull();
  });

  it('lists only what the person is selling on Shop, under the header it is given', async () => {
    answerWith(api.call, { 'GET /trades': page([sale, purchase]) });
    renderWithApi(api.call, <HomeScreen side="SELLER" header={<p>Shop strip</p>} />);
    expect(await screen.findByRole('heading', { name: 'Your selling activity' })).toBeTruthy();
    expect(screen.getByText('Shop strip')).toBeTruthy();
    expect(screen.getByText(/MacBook Air/)).toBeTruthy();
    expect(screen.queryByText(/Ankara fabric/)).toBeNull();
  });

  it('says there are no sales yet on Shop when the person has only bought', async () => {
    answerWith(api.call, { 'GET /trades': page([purchase]) });
    renderWithApi(api.call, <HomeScreen side="SELLER" header={<p>Shop strip</p>} />);
    expect(await screen.findByText('No sales yet')).toBeTruthy();
    expect(screen.getByText('Shop strip')).toBeTruthy();
  });
});
