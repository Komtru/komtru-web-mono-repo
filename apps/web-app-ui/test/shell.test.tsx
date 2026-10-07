// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountSections } from '../src/shell/AccountSections';
import { AppShell } from '../src/shell/AppShell';
import { ANONYMOUS_VIEWER, type TabId, type Viewer } from '../src/shell/nav';
import { expectNoAxeViolations } from './axe';

afterEach(cleanup);

const viewer = (overrides: Partial<Viewer> = {}): Viewer => ({ ...ANONYMOUS_VIEWER, ...overrides });
const links = { parkUrl: 'https://park.komtru.com' };

const shell = (overrides: Partial<Viewer> = {}, tab: TabId = 'trades') =>
  render(
    <AppShell tab={tab} viewer={viewer(overrides)}>
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

  it('gives a certified merchant Shop where Explore was, and no extra tab', () => {
    shell({ certifiedMerchant: true }, 'shop');
    expect(screen.queryByRole('link', { name: 'Explore' })).toBeNull();
    // One per navigation, again.
    expect(screen.getAllByRole('link', { name: 'Shop' })).toHaveLength(3);
  });

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
