import { describe, expect, it } from 'vitest';
import { accountItemsFor, ANONYMOUS_VIEWER, currentTab, tabsFor, type Viewer } from '../src/shell/nav';

const viewer = (overrides: Partial<Viewer> = {}): Viewer => ({ ...ANONYMOUS_VIEWER, ...overrides });

const labels = (items: readonly { label: string }[]) => items.map((item) => item.label);

describe('the tab bar and the sidebar (design C22, §6.3)', () => {
  it('is five destinations, the same five at every width', () => {
    expect(labels(tabsFor(viewer()))).toEqual(['Trades', 'Explore', 'Alerts', 'Messages', 'Account']);
  });

  it('gives a certified merchant Shop in place of Explore, because a merchant cannot buy', () => {
    expect(labels(tabsFor(viewer({ certifiedMerchant: true })))).toEqual([
      'Trades',
      'Shop',
      'Alerts',
      'Messages',
      'Account',
    ]);
  });

  it('keeps Shop in Explore’s position rather than adding a sixth tab', () => {
    const certified = tabsFor(viewer({ certifiedMerchant: true }));
    expect(certified).toHaveLength(5);
    expect(certified[1]?.id).toBe('shop');
  });

  it('never offers a role switcher or a seller tab bar', () => {
    for (const person of [viewer(), viewer({ certifiedMerchant: true, hasSold: true })]) {
      const text = labels(tabsFor(person)).join(' ');
      expect(text).not.toMatch(/switch|seller|buyer|listings|payouts/i);
    }
  });

  it('points Trades at the app’s home, which is the one list of both sides of every trade', () => {
    expect(tabsFor(viewer())[0]).toMatchObject({ id: 'trades', href: '/trades' });
  });
});

describe('which tab a URL is under', () => {
  it('matches a tab’s own route and everything below it', () => {
    expect(currentTab('/trades', viewer())).toBe('trades');
    expect(currentTab('/trades/KMT-88213', viewer())).toBe('trades');
    expect(currentTab('/account/verification', viewer())).toBe('account');
  });

  it('matches whole segments, so /tradesmanship is under no tab', () => {
    expect(currentTab('/tradesmanship', viewer())).toBeUndefined();
  });

  it('is undefined on a screen that belongs to no tab, rather than guessing one', () => {
    expect(currentTab('/hub/register', viewer())).toBeUndefined();
  });

  it('reads /shop as the merchant’s second tab and /explore as nobody’s', () => {
    const merchant = viewer({ certifiedMerchant: true });
    expect(currentTab('/shop/listings', merchant)).toBe('shop');
    expect(currentTab('/explore', merchant)).toBeUndefined();
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
