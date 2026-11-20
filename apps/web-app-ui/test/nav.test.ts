import { describe, expect, it } from 'vitest';
import {
  accountItemsFor,
  ANONYMOUS_VIEWER,
  BELL_HREF,
  currentTab,
  ROOT_DESTINATION,
  searchDestination,
  tabsFor,
  type Viewer,
} from '../src/shell/nav';

const viewer = (overrides: Partial<Viewer> = {}): Viewer => ({ ...ANONYMOUS_VIEWER, ...overrides });

const labels = (items: readonly { label: string }[]) => items.map((item) => item.label);

describe('the tab bar, the sidebar and the top nav (v2: DX-03, TX-02)', () => {
  it('is five destinations, the same five at every width', () => {
    expect(labels(tabsFor(viewer()))).toEqual(['Home', 'Trades', 'Messages', 'Discover', 'Account']);
  });

  // Owner ruling 2026-11-20: one account, one navigation. Buying and selling are sides of a trade.
  it('is the same for a certified merchant and someone who has sold: there is no Sell mode', () => {
    const everyone = labels(tabsFor(viewer()));
    expect(labels(tabsFor(viewer({ certifiedMerchant: true })))).toEqual(everyone);
    expect(labels(tabsFor(viewer({ hasSold: true })))).toEqual(everyone);
  });

  it('has no Shop, Orders or Listings destination', () => {
    for (const label of ['Shop', 'Orders', 'Listings'])
      expect(labels(tabsFor(viewer({ certifiedMerchant: true })))).not.toContain(label);
  });

  it('takes Alerts out of the nav: it is the bell in the top bar', () => {
    expect(labels(tabsFor(viewer()))).not.toContain('Alerts');
    expect(BELL_HREF).toBe('/alerts');
  });

  it('points Discover at search, because the browse catalogue is deferred', () => {
    expect(tabsFor(viewer()).find((tab) => tab.id === 'discover')?.href).toBe('/search');
  });

  it('never draws a role switcher or a seller tab bar as a destination', () => {
    const text = labels(tabsFor(viewer())).join(' ');
    expect(text).not.toMatch(/switch|role|buyer|seller/i);
  });

  it('opens the root at Home for everyone', () => {
    expect(ROOT_DESTINATION).toBe('/home');
  });
});

describe('which tab a URL is under', () => {
  it('matches a tab’s own route and everything below it', () => {
    expect(currentTab('/trades', viewer())).toBe('trades');
    expect(currentTab('/trades/KMT-88213', viewer())).toBe('trades');
    expect(currentTab('/account/verification', viewer())).toBe('account');
    expect(currentTab('/home', viewer())).toBe('home');
  });

  it('matches whole segments, so /tradesmanship is under no tab', () => {
    expect(currentTab('/tradesmanship', viewer())).toBeUndefined();
  });

  it('is undefined on a screen that belongs to no tab, rather than guessing one', () => {
    expect(currentTab('/hub/register', viewer())).toBeUndefined();
    expect(currentTab('/alerts', viewer())).toBeUndefined();
    expect(currentTab('/shop', viewer())).toBeUndefined();
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

  it('holds the F-044 sections after Privacy & data, for everyone', () => {
    const items = accountItemsFor(viewer(), links);
    expect(items.slice(6, 10).map((item) => [item.id, item.label, item.href])).toEqual([
      ['addresses', 'Saved addresses', '/account/addresses'],
      ['display', 'Display & accessibility', '/account/display'],
      ['refunds', 'Where’s my refund?', '/account/refunds'],
      ['statements', 'Statements', '/account/statements'],
    ]);
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
    expect(tabsFor(viewer({ parkAgent: 'active' })).map((tab) => tab.href)).not.toContain(links.parkUrl);
  });
});
