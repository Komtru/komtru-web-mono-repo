// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountSections } from '../src/shell/AccountSections';
import { AppShell } from '../src/shell/AppShell';
import { ANONYMOUS_VIEWER, type Mode, type TabId, type Viewer } from '../src/shell/nav';
import { expectNoAxeViolations } from './axe';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const viewer = (overrides: Partial<Viewer> = {}): Viewer => ({ ...ANONYMOUS_VIEWER, ...overrides });
const links = { parkUrl: 'https://park.komtru.com' };

const shell = (overrides: Partial<Viewer> = {}, tab: TabId = 'trades', mode: Mode = 'buy') =>
  render(
    <AppShell tab={tab} viewer={viewer(overrides)} mode={mode}>
      <h1>My Trades</h1>
    </AppShell>,
  );

describe('AppShell', () => {
  it('draws the page content once, under one main landmark', () => {
    // The reason the shell composes the navigations instead of rendering `<MobileShell>` and
    // `<DesktopShell>` side by side: two shells means two mains and the content twice.
    const { container } = shell();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { name: 'My Trades' })).toHaveLength(1);
  });

  it('carries all three navigations, each under its own name', () => {
    shell();
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Sections menu' })).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Sections sidebar' })).toBeDefined();
  });

  it('hides the tab bar from md up and the rails below their own widths', () => {
    const { container } = shell();
    expect(screen.getByRole('navigation', { name: 'Sections' }).className).toContain('md:hidden');
    // The tablet nav's wrapper, because `<TopNav>` is a flex row and `hidden` has to beat that.
    // `<TopNav>` is a `<header>` holding the `<nav>`, so the wrapper is the header's parent.
    const tabletNav = screen.getByRole('navigation', { name: 'Sections menu' });
    expect(tabletNav.closest('header')?.parentElement?.className).toBe('hidden md:block lg:hidden');
    expect(container.querySelector('aside')?.className).toContain('hidden lg:block');
  });

  it('marks the current destination once, in every navigation that is drawn', () => {
    const { container } = shell();
    const current = [...container.querySelectorAll('[aria-current="page"]')];
    // One per navigation: the tab bar, the tablet nav and the sidebar each mark Trades.
    expect(current).toHaveLength(3);
    for (const node of current) expect(node.textContent).toContain('Trades');
  });

  it('marks nothing on a screen that belongs to no tab, rather than guessing one', () => {
    const { container } = render(
      <AppShell viewer={viewer()}>
        <h1>Offline</h1>
      </AppShell>,
    );
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
  });

  it('draws the five Buy destinations in all three navigations, and no Alerts tab', () => {
    shell();
    for (const name of ['Home', 'Trades', 'Messages', 'Discover', 'Account']) {
      expect(screen.getAllByRole('link', { name })).toHaveLength(3);
    }
    expect(screen.queryByRole('link', { name: 'Explore' })).toBeNull();
    // Alerts is the bell, not a tab: one in the desktop bar and one in the tablet nav.
    expect(screen.getAllByRole('link', { name: 'Alerts' })).toHaveLength(2);
  });

  it('draws Shop, Orders and Listings in Sell mode, five destinations again', () => {
    shell({}, 'shop', 'sell');
    for (const name of ['Shop', 'Orders', 'Listings', 'Messages', 'Account']) {
      expect(screen.getAllByRole('link', { name })).toHaveLength(3);
    }
    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull();
  });

  it('points Discover at /browse', () => {
    shell();
    expect(screen.getAllByRole('link', { name: 'Discover' })[0]?.getAttribute('href')).toBe('/browse');
  });

  it('collapses the desktop sidebar to icons and expands it again', () => {
    const { container } = shell();
    const aside = container.querySelector('aside');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(aside?.className).toContain('w-[64px]');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(aside?.className).toContain('w-[180px]');
  });
});

describe('the top bar tools (v2: DX-03, TX-02)', () => {
  const pressed = (mode: 'Buy' | 'Sell') =>
    screen.getAllByRole('button', { name: mode }).map((button) => button.getAttribute('aria-pressed'));

  it('shows the Buy/Sell switch with the current mode pressed, in the mobile header too', () => {
    const { container, unmount } = shell();
    // Desktop bar, tablet nav and mobile header each carry one.
    expect(screen.getAllByRole('group', { name: 'Buy or sell mode' })).toHaveLength(3);
    expect(pressed('Buy')).toEqual(['true', 'true', 'true']);
    expect(pressed('Sell')).toEqual(['false', 'false', 'false']);
    const mobile = container.querySelector('header.md\\:hidden');
    expect(mobile?.querySelector('[role="group"]')).not.toBeNull();
    unmount();
    shell({}, 'shop', 'sell');
    expect(pressed('Sell')).toEqual(['true', 'true', 'true']);
  });

  it('remembers the chosen mode and opens its landing screen', () => {
    shell();
    fireEvent.click(screen.getAllByRole('button', { name: 'Sell' })[0] as HTMLElement);
    expect(document.cookie).toContain('komtru_mode=sell');
    expect(router.push).toHaveBeenCalledWith('/shop');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('opens Home when switching from Sell to Buy', () => {
    shell({}, 'shop', 'sell');
    fireEvent.click(screen.getAllByRole('button', { name: 'Buy' })[0] as HTMLElement);
    expect(document.cookie).toContain('komtru_mode=buy');
    expect(router.push).toHaveBeenCalledWith('/home');
  });

  it('works from the mobile header exactly as on desktop', () => {
    const { container } = shell();
    const mobile = container.querySelector('header.md\\:hidden') as HTMLElement;
    fireEvent.click(within(mobile).getByRole('button', { name: 'Sell' }));
    expect(router.push).toHaveBeenCalledWith('/shop');
  });

  it('locks the switch on Sell for a certified merchant, in every copy, and says why', () => {
    shell({ certifiedMerchant: true }, 'shop', 'sell');
    for (const buy of screen.getAllByRole('button', { name: 'Buy' })) {
      expect(buy.getAttribute('aria-disabled')).toBe('true');
      expect(buy.getAttribute('aria-describedby')).toBeTruthy();
      fireEvent.click(buy);
    }
    expect(screen.getAllByText('Certified merchants sell only')).toHaveLength(3);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('draws each duplicated copy of the tools inside an ancestor that hides it at the other widths', () => {
    shell();
    for (const name of ['Alerts', 'Your account']) {
      for (const link of screen.getAllByRole('link', { name })) {
        expect(link.closest('[class~="hidden"]'), name).not.toBeNull();
      }
    }
    for (const group of screen.getAllByRole('group', { name: 'Buy or sell mode' })) {
      expect(group.closest('[class~="hidden"], [class~="md:hidden"]')).not.toBeNull();
    }
    for (const search of screen.getAllByRole('search')) {
      expect(search.closest('[class~="hidden"]')).not.toBeNull();
    }
  });

  it('searches by Trade Code and by words from the one bar', () => {
    shell();
    const search = screen.getByRole('searchbox', { name: 'Search' });
    expect(search.getAttribute('placeholder')).toBe('Search trades or sellers — or enter a Trade Code');
    fireEvent.change(search, { target: { value: 'KMT-88213' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(router.push).toHaveBeenCalledWith('/trades?code=KMT-88213');

    fireEvent.change(search, { target: { value: 'iphone' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(router.push).toHaveBeenLastCalledWith('/browse?q=iphone');
  });

  it('links the bell to Alerts and the profile to Account', () => {
    shell();
    expect(screen.getAllByRole('link', { name: 'Alerts' })[0]?.getAttribute('href')).toBe('/alerts');
    expect(screen.getAllByRole('link', { name: 'Your account' })[0]?.getAttribute('href')).toBe('/account');
  });
});

describe('AppShell chrome', () => {
  it('steps the content padding from mobile through tablet to desktop', () => {
    const { container } = shell();
    const main = container.querySelector('main');
    // `.scr-body`'s 16px with the tab bar's 90px of clearance, `.tweb-content`'s 20px, then
    // `.dweb-content`'s 24px.
    expect(main?.className).toContain('p-[16px]');
    expect(main?.className).toContain('pb-[90px]');
    expect(main?.className).toContain('md:p-[20px]');
    expect(main?.className).toContain('lg:p-[24px]');
  });

  it('lets a route replace the rail, which is what Account does (D9)', () => {
    render(
      <AppShell
        tab="account"
        viewer={viewer()}
        nav={{ label: 'Account', items: [{ label: 'Personal info', href: '/account/personal-info' }] }}
      >
        <h1>Account</h1>
      </AppShell>,
    );
    const sidebar = screen.getByRole('navigation', { name: 'Sections sidebar' });
    expect(sidebar.textContent).toBe('Personal info');
    // The tab bar is still the app's: the person is in Account, not in another app.
    expect(screen.getByRole('navigation', { name: 'Sections' }).textContent).toContain('Messages');
  });

  it('has no serious accessibility violations', async () => {
    const { container } = shell();
    // The two landmark-duplication rules are off here and only here. jsdom applies no stylesheet,
    // so the mobile brand row and the tablet top nav — one page header, drawn at two widths — are
    // both present and both count as a banner; in a browser exactly one of them is displayed and
    // the other is `display:none`, which takes it out of the accessibility tree entirely. The
    // assertions above are what hold that true: each chrome carries the variant that hides it.
    await expectNoAxeViolations(container, ['landmark-no-duplicate-banner', 'landmark-unique']);
  });
});

describe('Account’s sections', () => {
  it('splits what every account has from what this person has done', () => {
    render(<AccountSections viewer={viewer({ hasSold: true })} links={links} />);
    expect(screen.getByRole('heading', { name: 'Your account' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Selling and Park' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Payouts' })).toBeDefined();
  });

  it('states the Park Agent row’s state on the row, and leaves the app only once it is active', () => {
    const { rerender } = render(<AccountSections viewer={viewer()} links={links} />);
    expect(screen.getByRole('link', { name: /Park Agent/ }).getAttribute('href')).toBe('/hub/register');

    rerender(<AccountSections viewer={viewer({ parkAgent: 'active' })} links={links} />);
    const active = screen.getByRole('link', { name: /Park Agent/ });
    expect(active.getAttribute('href')).toBe(links.parkUrl);
    expect(active.textContent).toContain('Active');
  });

  it('has no serious accessibility violations', async () => {
    const { container } = render(
      <AccountSections viewer={viewer({ hasSold: true, parkAgent: 'pending' })} links={links} />,
    );
    await expectNoAxeViolations(container);
  });
});
