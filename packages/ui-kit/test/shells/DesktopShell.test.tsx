// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DesktopShell, SideNav, TopNav } from '../../src/index.js';
import '../primitives/setup.js';

const ICON = <svg aria-hidden viewBox="0 0 24 24" />;
const NAV = [
  { label: 'Personal Info', icon: ICON, href: '/settings', current: true },
  { label: 'Verification', icon: ICON, href: '/settings/verification' },
  { label: 'Trust History', icon: ICON, href: '/settings/history' },
];

describe('SideNav', () => {
  it('is the 180px rail the reference draws', () => {
    const { container } = render(<SideNav brandLabel="Account" items={NAV} />);
    expect(container.querySelector('aside')?.className).toContain('w-[180px]');
  });

  it('names the section rather than the product', () => {
    render(<SideNav brandLabel="Account" items={NAV} />);
    expect(screen.getByText('Account')).toBeDefined();
  });

  it('gives the current destination the indigo pill and the rest slate', () => {
    render(<SideNav brandLabel="Account" items={NAV} />);
    const current = screen.getByRole('link', { name: /Personal Info/ });
    expect(current.className).toContain('bg-trust-indigo-soft');
    expect(current.className).toContain('text-info-on-soft');
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /Verification/ }).className).toContain('text-slate');
  });

  it('refuses two current destinations', () => {
    const two = NAV.map((item) => ({ ...item, current: true }));
    expect(() => render(<SideNav brandLabel="Account" items={two} />)).toThrow(RangeError);
  });

  it('names its landmark so a screen can tell two navigations apart', () => {
    render(<SideNav brandLabel="Account" items={NAV} label="Account settings" />);
    expect(screen.getByRole('navigation', { name: 'Account settings' })).toBeDefined();
  });
});

describe('TopNav', () => {
  it('draws the brand alone when a screen gives it no destinations', () => {
    // T3, T4 and T5 are exactly this: a login form and two public pages need no tabs.
    render(<TopNav brandLabel="Komtru" />);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByText('Komtru')).toBeDefined();
  });

  it('draws the destinations as text pills, opposite the brand', () => {
    render(<TopNav brandLabel="TechEdge NG" items={NAV} />);
    const current = screen.getByRole('link', { name: 'Personal Info' });
    expect(current.className).toContain('rounded-full');
    expect(current.className).toContain('bg-trust-indigo-soft');
  });

  it('refuses two current destinations', () => {
    const two = NAV.map((item) => ({ ...item, current: true }));
    expect(() => render(<TopNav brandLabel="Komtru" items={two} />)).toThrow(RangeError);
  });
});

describe('DesktopShell', () => {
  const shell = () =>
    render(
      <DesktopShell brandLabel="Account" nav={NAV}>
        Body
      </DesktopShell>,
    );

  it('shows the top nav below lg and the sidebar at lg', () => {
    const { container } = shell();
    expect(container.querySelector('header')?.className).toContain('lg:hidden');
    const aside = container.querySelector('aside')?.className ?? '';
    expect(aside.split(/\s+/)).toContain('hidden');
    expect(aside).toContain('lg:block');
  });

  it('names the same destinations in both navigations', () => {
    // One `nav` prop, drawn twice. A shell that took two lists would let the tablet and the desktop
    // drift into different products.
    shell();
    expect(screen.getAllByRole('link', { name: /Verification/ })).toHaveLength(2);
  });

  it('steps the content padding from the tablet 20px to the desktop 24px', () => {
    const { container } = shell();
    const main = container.querySelector('main')?.className ?? '';
    expect(main).toContain('p-[20px]');
    expect(main).toContain('lg:p-[24px]');
  });

  it('refuses two current destinations before either nav renders', () => {
    const two = NAV.map((item) => ({ ...item, current: true }));
    expect(() => render(<DesktopShell brandLabel="Account" nav={two} />)).toThrow(RangeError);
  });

  it('has no gallery frame: the viewport is the height and the document scrolls', () => {
    const { container } = shell();
    const root = container.firstElementChild?.className ?? '';
    expect(root).toContain('min-h-dvh');
    expect(root).not.toContain('min-h-[520px]');
    expect(container.querySelector('main')?.className).not.toContain('overflow-y-auto');
  });

  it('lays out as a column below lg and a row at lg', () => {
    const { container } = shell();
    const root = container.firstElementChild?.className ?? '';
    expect(root).toContain('flex-col');
    expect(root).toContain('lg:flex-row');
  });
});
