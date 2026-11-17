import { describe, expect, it } from 'vitest';
import {
  accountItemsFor,
  ANONYMOUS_VIEWER,
  BELL_HREF,
  currentTab,
  landingFor,
  modeCookie,
  modeFor,
  rootDestination,
  searchDestination,
  tabsFor,
  type Viewer,
} from '../src/shell/nav';

const viewer = (overrides: Partial<Viewer> = {}): Viewer => ({ ...ANONYMOUS_VIEWER, ...overrides });

const labels = (items: readonly { label: string }[]) => items.map((item) => item.label);

describe('the tab bar, the sidebar and the top nav (v2: DX-03, DX-04, TX-02)', () => {
  it('is five destinations in Buy mode, the same five at every width', () => {
    expect(labels(tabsFor(viewer(), 'buy'))).toEqual(['Home', 'Trades', 'Messages', 'Discover', 'Account']);
  });

  it('defaults to Buy mode', () => {
    expect(labels(tabsFor(viewer()))).toEqual(labels(tabsFor(viewer(), 'buy')));
  });

  it('is Shop, Orders, Listings, Messages and Account in Sell mode', () => {
    expect(labels(tabsFor(viewer(), 'sell'))).toEqual(['Shop', 'Orders', 'Listings', 'Messages', 'Account']);
  });

  it('keeps five destinations in both modes, and Messages and Account in both', () => {
    for (const mode of ['buy', 'sell'] as const) {
      const tabs = tabsFor(viewer(), mode);
      expect(tabs).toHaveLength(5);
      expect(tabs.map((tab) => tab.id)).toEqual(expect.arrayContaining(['messages', 'account']));
    }
  });

  it('takes Alerts out of the nav: it is the bell in the top bar', () => {
    for (const mode of ['buy', 'sell'] as const) {
      expect(labels(tabsFor(viewer(), mode))).not.toContain('Alerts');
    }
    expect(BELL_HREF).toBe('/alerts');
  });

  it('points Discover at search, because the browse catalogue is deferred', () => {
    expect(tabsFor(viewer(), 'buy').find((tab) => tab.id === 'discover')?.href).toBe('/search');
  });

  it('never draws a role switcher or a seller tab bar as a destination', () => {
    const text = labels(tabsFor(viewer(), 'buy')).join(' ');
    expect(text).not.toMatch(/switch|role|buyer|seller/i);
  });
});

describe('the mode a person is in', () => {
  it('is what they chose, Buy when they have not chosen', () => {
    expect(modeFor(viewer(), undefined)).toBe('buy');
    expect(modeFor(viewer(), 'sell')).toBe('sell');
    expect(modeFor(viewer(), 'buy')).toBe('buy');
  });

  it('ignores a value that is not a mode', () => {
    expect(modeFor(viewer(), 'merchant')).toBe('buy');
  });

  it('is always Sell for a certified merchant, who cannot buy (design 6.3)', () => {
    expect(modeFor(viewer({ certifiedMerchant: true }), 'buy')).toBe('sell');
    expect(modeFor(viewer({ certifiedMerchant: true }), undefined)).toBe('sell');
  });

  it('gives a certified viewer the Sell tabs and the Sell landing whatever the cookie says', () => {
    // TODO(T-111): the cookie is a view preference only. Buyer routes must be rejected on the server
    // when the session says `canActAsBuyer === false`; nothing here enforces that.
    const certified = viewer({ certifiedMerchant: true });
    for (const chosen of ['buy', 'sell', 'merchant', undefined]) {
      const mode = modeFor(certified, chosen);
      expect(mode).toBe('sell');
      expect(labels(tabsFor(certified, mode))).toEqual(['Shop', 'Orders', 'Listings', 'Messages', 'Account']);
      expect(rootDestination(certified, chosen)).toBe('/shop');
    }
  });

  it('opens the root at the landing screen of the mode the person is in', () => {
    expect(rootDestination(viewer(), undefined)).toBe('/home');
    expect(rootDestination(viewer(), 'buy')).toBe('/home');
    expect(rootDestination(viewer(), 'sell')).toBe('/shop');
  });

  it('writes the mode cookie as a Lax preference, Secure everywhere but localhost', () => {
    expect(modeCookie('sell', true)).toBe('komtru_mode=sell; path=/; max-age=31536000; samesite=lax; secure');
    expect(modeCookie('buy', false)).toBe('komtru_mode=buy; path=/; max-age=31536000; samesite=lax');
  });

  it('opens each mode at its own landing screen', () => {
    expect(landingFor('buy')).toBe('/home');
    expect(landingFor('sell')).toBe('/shop');
  });
});

describe('which tab a URL is under', () => {
  it('matches a tab’s own route and everything below it', () => {
    expect(currentTab('/trades', viewer(), 'buy')).toBe('trades');
    expect(currentTab('/trades/KMT-88213', viewer(), 'buy')).toBe('trades');
    expect(currentTab('/account/verification', viewer(), 'buy')).toBe('account');
    expect(currentTab('/home', viewer(), 'buy')).toBe('home');
  });

  it('matches whole segments, so /tradesmanship is under no tab', () => {
    expect(currentTab('/tradesmanship', viewer(), 'buy')).toBeUndefined();
  });

  it('is undefined on a screen that belongs to no tab, rather than guessing one', () => {
    expect(currentTab('/hub/register', viewer(), 'buy')).toBeUndefined();
    expect(currentTab('/alerts', viewer(), 'buy')).toBeUndefined();
  });

  it('reads /shop and /orders under Sell mode only', () => {
    expect(currentTab('/shop/listings', viewer(), 'sell')).toBe('shop');
    expect(currentTab('/orders', viewer(), 'sell')).toBe('orders');
    expect(currentTab('/orders', viewer(), 'buy')).toBeUndefined();
    expect(currentTab('/browse', viewer(), 'sell')).toBeUndefined();
  });
});

describe('the global search and Trade Code bar', () => {
  it("sends a Trade Code to that code's page, in its canonical form", () => {
    expect(searchDestination('KMT-88213')).toBe('/trades/KMT-88213-NG');
    expect(searchDestination('  kmt-88213 ')).toBe('/trades/KMT-88213-NG');
    expect(searchDestination('KMT-7398512-ng')).toBe('/trades/KMT-7398512-NG');
  });

  it('treats a string too short to be a code as a search', () => {
    expect(searchDestination('kmt-9')).toBe('/search?q=kmt-9');
  });

  it('sends anything else to the search of the person’s own trades, encoded', () => {
    expect(searchDestination('iPhone 13 & case')).toBe('/search?q=iPhone%2013%20%26%20case');
  });

  it('goes nowhere on an empty query', () => {
    expect(searchDestination('   ')).toBeUndefined();
  });

  it.each([
    ['//evil.com', '/search?q=%2F%2Fevil.com'],
    ['https://x', '/search?q=https%3A%2F%2Fx'],
    ['KMT-1/../x', '/search?q=KMT-1%2F..%2Fx'],
    ['KMT-1?x', '/search?q=KMT-1%3Fx'],
    ['KMT 9', '/search?q=KMT%209'],
    ['100%', '/search?q=100%25'],
    ['KMT-1 KMT-2', '/search?q=KMT-1%20KMT-2'],
  ])('keeps hostile input %j inside search, as a query value', (query, expected) => {
    const to = searchDestination(query);
    expect(to).toBe(expected);
    expect(to?.startsWith('/search?q=')).toBe(true);
  });
});

describe('Account', () => {
  const links = { parkUrl: 'https://park.komtru.com' };

  it('holds the sections D9 draws in its sidebar', () => {
    expect(labels(accountItemsFor(viewer(), links)).slice(0, 5)).toEqual([
      'Personal info',
      'Verification',
      'Trust history',
      'Notifications',
      'Security',
    ]);
  });

  it('holds Privacy & data after the five, for everyone, and Security still opens the security screen (F-045)', () => {
    const items = accountItemsFor(viewer(), links);
    expect(items[5]).toMatchObject({ id: 'privacy', label: 'Privacy & data', href: '/account/privacy' });
    expect(items.find((item) => item.id === 'security')?.href).toBe('/account/security');
  });

  it('holds Payouts for anyone who has sold, merchant or not', () => {
    expect(labels(accountItemsFor(viewer(), links))).not.toContain('Payouts');
    expect(labels(accountItemsFor(viewer({ hasSold: true }), links))).toContain('Payouts');
    expect(labels(accountItemsFor(viewer({ hasSold: true, certifiedMerchant: false }), links))).toContain(
      'Payouts',
    );
  });

  it('opens the hub application for someone who has never applied', () => {
    const park = accountItemsFor(viewer(), links).find((item) => item.id === 'park-agent');
    expect(park).toMatchObject({ href: '/hub/register', status: 'Not yet set up' });
    expect(park?.external).toBeUndefined();
  });

  it('shows an application still being reviewed, and keeps it inside this app', () => {
    const park = accountItemsFor(viewer({ parkAgent: 'pending' }), links).find((i) => i.id === 'park-agent');
    expect(park).toMatchObject({ href: '/hub/application', status: 'Application in review' });
    expect(park?.external).toBeUndefined();
  });

  it('sends an active agent to park.komtru.com, which is a different app', () => {
    const park = accountItemsFor(viewer({ parkAgent: 'active' }), links).find((i) => i.id === 'park-agent');
    expect(park).toMatchObject({ href: 'https://park.komtru.com', external: true, status: 'Active' });
  });

  it('is the only place the Park Agent entry point exists', () => {
    // Not a tab, not a role: design §6.3 puts it in Account and nowhere else.
    expect(tabsFor(viewer({ parkAgent: 'active' }), 'buy').map((tab) => tab.href)).not.toContain(
      links.parkUrl,
    );
  });
});
