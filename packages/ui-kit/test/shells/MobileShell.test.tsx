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

  it('gives the current tab an indigo-soft pill and indigo text, and the rest a quiet grey', () => {
    // v2 states the colour on the item (`.kmn-item.is-active{color;background}`) and the glyph takes
    // it through `currentColor`, so the icon wrapper strokes with the item's colour rather than
    // carrying a colour of its own.
    render(<TabBar items={TABS} />);
    const current = screen.getByRole('button', { name: /Trades/ });
    expect(current.className).toContain('text-trust-indigo');
    expect(current.className).toContain('bg-trust-indigo-soft');
    expect(current.firstElementChild?.className).toContain('stroke-current');
    const other = screen.getByRole('button', { name: /Alerts/ });
    // eslint-disable-next-line komtru-design/no-raw-hex -- v2's resting grey has no token.
    expect(other.className).toContain('text-[#7A8496]');
    expect(other.className).not.toContain('bg-trust-indigo-soft');
  });

  it('takes a class list, so a one-shell app can hide it where the top nav takes over', () => {
    // The nav does not decide its own visibility, the same way `<SideNav>` does not — an app that
    // draws one responsive shell rather than two needs the tab bar gone from `md` up.
    const { container } = render(<TabBar items={TABS} className="md:hidden" />);
    expect(container.firstElementChild?.className).toContain('md:hidden');
    expect(container.firstElementChild?.className).toContain('sticky');
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

  it('renders header, body and the sticky footer in that order', () => {
    const { container } = render(
      <MobileShell
        header={<TopBar title="Enter code" />}
        footer={
          <StickyFooter>
            <Button>Verify &amp; continue</Button>
          </StickyFooter>
        }
      >
        Body
      </MobileShell>,
    );
    const tags = [...(container.firstElementChild?.children ?? [])].map((child) => child.tagName);
    expect(tags).toEqual(['HEADER', 'MAIN', 'DIV']);
  });

  it('renders header, body and the tab bar in that order', () => {
    const { container } = render(
      <MobileShell header={<TopBar title="My Trades" />} tabs={<TabBar items={TABS} />}>
        Body
      </MobileShell>,
    );
    const tags = [...(container.firstElementChild?.children ?? [])].map((child) => child.tagName);
    expect(tags).toEqual(['HEADER', 'MAIN', 'NAV']);
  });

  it('refuses a screen that asks for both a sticky footer and a tab bar', () => {
    // Both are `sticky bottom-0`: on a body long enough to scroll they pin to the same edge and
    // overlap, and which one a person sees is whichever paints last. Measured in Chromium at
    // 340×660: the footer lands at y=614–660 and the tab bar's top at y=618.
    expect(() =>
      render(
        <MobileShell footer={<StickyFooter>f</StickyFooter>} tabs={<TabBar items={TABS} />}>
          Body
        </MobileShell>,
      ),
    ).toThrow(RangeError);
  });

  it('is just the body when a screen carries no chrome at all', () => {
    const { container } = render(<MobileShell>Body</MobileShell>);
    expect([...(container.firstElementChild?.children ?? [])].map((c) => c.tagName)).toEqual(['MAIN']);
  });
});
