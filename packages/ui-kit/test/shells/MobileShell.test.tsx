// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button, MobileShell, StickyFooter, TabBar, TopBar } from '../../src/index.js';
import '../primitives/setup.js';

const ICON = <svg aria-hidden viewBox="0 0 24 24" />;
const TABS = [
  { label: 'Trades', icon: ICON, current: true },
  { label: 'Passport', icon: ICON },
  { label: 'Alerts', icon: ICON },
  { label: 'Settings', icon: ICON },
];

describe('TabBar', () => {
  it('marks exactly one tab as the current page', () => {
    const { container } = render(<TabBar items={TABS} />);
    const current = container.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe('Trades');
  });

  it('refuses two current tabs rather than announcing both', () => {
    const two = [
      { label: 'Trades', icon: ICON, current: true },
      { label: 'Alerts', icon: ICON, current: true },
    ];
    expect(() => render(<TabBar items={two} />)).toThrow(RangeError);
  });

  it('marks none when a screen belongs to no tab', () => {
    const { container } = render(<TabBar items={TABS.map(({ current: _, ...rest }) => rest)} />);
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
  });

  it('is a navigation landmark with a name a screen can change', () => {
    render(<TabBar items={TABS} label="Customer sections" />);
    expect(screen.getByRole('navigation', { name: 'Customer sections' })).toBeDefined();
  });

  it('gives the current tab indigo and the rest trust-gray', () => {
    render(<TabBar items={TABS} />);
    expect(screen.getByRole('button', { name: /Trades/ }).className).toContain('text-trust-indigo');
    expect(screen.getByRole('button', { name: /Alerts/ }).className).toContain('text-trust-gray');
  });

  it('renders a tab with an href as a link', () => {
    render(<TabBar items={[{ label: 'Trades', icon: ICON, href: '/trades' }]} />);
    expect(screen.getByRole('link', { name: 'Trades' }).getAttribute('href')).toBe('/trades');
  });
});

describe('MobileShell', () => {
  it('pushes the tab bar to the bottom when the body is empty', () => {
    // `.scr-tabbar{margin-top:auto}` is the whole mechanism, and it does nothing unless the root is
    // a full-height flex column — so an empty screen is the case that proves the root is right.
    const { container } = render(<MobileShell tabs={<TabBar items={TABS} />} />);
    const root = container.firstElementChild;
    expect(root?.className).toContain('flex');
    expect(root?.className).toContain('flex-col');
    expect(root?.className).toContain('min-h-dvh');
    expect(screen.getByRole('navigation').className).toContain('mt-auto');
  });

  it('has no device frame: no fixed height, no inner scroller', () => {
    const { container } = render(<MobileShell>Body</MobileShell>);
    const className = container.firstElementChild?.className ?? '';
    expect(className).not.toContain('h-[660px]');
    expect(className).not.toContain('overflow-y-auto');
  });

  it("keeps the reference's 90px of bottom padding, so the tab bar never covers a card", () => {
    const { container } = render(<MobileShell>Body</MobileShell>);
    expect(container.querySelector('main')?.className).toContain('pb-[90px]');
  });

  it('renders header, body, footer and tabs in that order', () => {
    const { container } = render(
      <MobileShell
        header={<TopBar title="Enter code" />}
        footer={
          <StickyFooter>
            <Button>Verify &amp; continue</Button>
          </StickyFooter>
        }
        tabs={<TabBar items={TABS} />}
      >
        Body
      </MobileShell>,
    );
    const tags = [...(container.firstElementChild?.children ?? [])].map((child) => child.tagName);
    expect(tags).toEqual(['HEADER', 'MAIN', 'DIV', 'NAV']);
  });

  it('is just the body when a screen carries no chrome at all', () => {
    const { container } = render(<MobileShell>Body</MobileShell>);
    expect([...(container.firstElementChild?.children ?? [])].map((c) => c.tagName)).toEqual(['MAIN']);
  });
});
