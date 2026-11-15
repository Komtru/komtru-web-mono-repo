// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchTrades } from '../src/home/SearchTrades';
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

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const page = (items: unknown[], nextCursor: string | null = null) => ({ items, nextCursor });

const speaker = listItem(1, {
  tradeCode: 'KMT-9013800-NG',
  attention: null,
  status: 'PENDING_PAYMENT',
  awaiting: null,
  item: { title: 'Bluetooth Speaker', categoryCode: 'electronics', categoryName: 'Electronics' },
  counterparty: counterparty({ displayName: 'Prime Gadgets', username: 'primegadgets' }),
});
const phone = listItem(2, {
  tradeCode: 'KMT-9020000-NG',
  item: { title: 'iPhone 13 Pro, 256GB', categoryCode: 'electronics', categoryName: 'Electronics' },
  counterparty: counterparty({ displayName: 'TechEdge NG', username: 'techedge' }),
});

function search(initial = '') {
  return renderWithApi(api.call, <SearchTrades initialQuery={initial} />);
}

function type(value: string) {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search your trades' }), { target: { value } });
}

describe('Search your trades (SE1)', () => {
  beforeEach(() => {
    answerWith(api.call, { 'GET /trades': page([speaker, phone]) });
  });

  it('asks for a query and shows nothing until there is one', async () => {
    search();
    expect(await screen.findByRole('searchbox', { name: 'Search your trades' })).toBeTruthy();
    expect(await screen.findByText('Type an item, a name or a Trade Code.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: /Results/ })).toBeNull();
  });

  it('lists the trades that match the query, by item, category and the other party', async () => {
    search();
    await screen.findByRole('searchbox', { name: 'Search your trades' });
    type('speaker');
    const results = await screen.findByRole('region', { name: 'Results — "speaker"' });
    expect(
      within(results)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([`/trade/${id(1)}`]);

    type('electronics');
    expect(
      within(await screen.findByRole('region', { name: 'Results — "electronics"' }))
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([`/trade/${id(1)}`, `/trade/${id(2)}`]);

    type('@techedge');
    expect(
      within(await screen.findByRole('region', { name: 'Results — "@techedge"' }))
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([`/trade/${id(2)}`]);
  });

  it('finds a trade by its code, with or without the prefix and market suffix', async () => {
    search('KMT-9020000');
    expect(
      within(await screen.findByRole('region', { name: 'Results — "KMT-9020000"' }))
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([`/trade/${id(2)}`]);
  });

  it('takes its first query from the address, as the shell search bar sends it', async () => {
    search('speaker');
    expect(await screen.findByRole('region', { name: 'Results — "speaker"' })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search your trades' }).value).toBe(
      'speaker',
    );
  });

  it('offers to open a Trade Code that is not among the trades the person can see, in Find a Trade', async () => {
    search();
    await screen.findByRole('searchbox', { name: 'Search your trades' });
    type('KMT-9999999');
    const offer = await screen.findByRole('link', { name: 'Find trade KMT-9999999-NG' });
    expect(offer.getAttribute('href')).toBe('/find?code=KMT-9999999-NG');
  });

  it('says there are no results and offers to propose a trade (SE2)', async () => {
    search();
    await screen.findByRole('searchbox', { name: 'Search your trades' });
    type('drone');
    expect(await screen.findByRole('heading', { name: 'No trades match "drone"' })).toBeTruthy();
    expect(
      screen.getByText(
        'Search covers the trades you are party to. To start one, propose a trade and the other party can respond.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Propose a Trade' }).getAttribute('href')).toBe('/trade/new');
  });

  it('does not say there are no results while the rest of the trades are still being read', async () => {
    api.call.mockImplementation((_endpoint, input) => {
      const cursor = input?.query?.cursor;
      return cursor === undefined ? Promise.resolve(page([speaker], 'more')) : new Promise(() => undefined);
    });
    search();
    await screen.findByRole('searchbox', { name: 'Search your trades' });
    type('drone');
    expect(await screen.findByRole('status', { name: 'Still reading your trades' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'No trades match "drone"' })).toBeNull();
  });

  it('says only that it cannot tell yet when a later page fails and nothing matches, never "still reading" or "no match"', async () => {
    answerWith(api.call, {
      'GET /trades': ({ query }: { query?: Record<string, unknown> }) =>
        query?.cursor === undefined ? page([speaker], 'c2') : new Error('offline'),
    });
    search();
    await screen.findByRole('searchbox', { name: 'Search your trades' });
    type('drone');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(
      screen.getByText("Couldn't read all of your trades, so we can't tell yet whether one matches."),
    ).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Still reading your trades' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'No trades match "drone"' })).toBeNull();
    expect(screen.queryByText(/Still reading/)).toBeNull();
  });

  it('warns that some may be missing, beside the results it has, when a later page fails', async () => {
    answerWith(api.call, {
      'GET /trades': ({ query }: { query?: Record<string, unknown> }) =>
        query?.cursor === undefined ? page([speaker], 'c2') : new Error('offline'),
    });
    search();
    await screen.findByRole('searchbox', { name: 'Search your trades' });
    type('speaker');
    expect(await screen.findByRole('region', { name: 'Results — "speaker"' })).toBeTruthy();
    expect(screen.getByText("Couldn't read all of your trades, so some may not appear here.")).toBeTruthy();
  });

  it('passes the accessibility check with results on screen', async () => {
    const { container } = search();
    await screen.findByRole('searchbox', { name: 'Search your trades' });
    type('speaker');
    await screen.findByRole('region', { name: 'Results — "speaker"' });
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('Search while the list cannot be read', () => {
  it('says so and offers a retry', async () => {
    answerWith(api.call, { 'GET /trades': new Error('offline') });
    search('speaker');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
