// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CollapsibleSideNav,
  GlobalSearch,
  ModeSwitch,
  ResponsiveAppShell,
  SideNav,
  TopNav,
} from '../../src/index.js';
import '../primitives/setup.js';

const ICON = <svg aria-hidden viewBox="0 0 24 24" />;
const NAV = [
  { label: 'Home', icon: ICON, href: '/home', current: true },
  { label: 'Trades', icon: ICON, href: '/trades' },
];

describe('ModeSwitch (v2 `.role-toggle`)', () => {
  it('is a switch that reads Buy when off and Sell when on', () => {
    const { rerender } = render(<ModeSwitch mode="buy" onChange={() => {}} label="selling mode" />);
    const toggle = screen.getByRole('switch', { name: 'Buy, selling mode' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.textContent).toBe('Buy, selling mode');
    rerender(<ModeSwitch mode="sell" onChange={() => {}} label="selling mode" />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch').textContent).toBe('Sell, selling mode');
  });

  it('asks for the other mode when pressed', () => {
    const onChange = vi.fn();
    render(<ModeSwitch mode="buy" onChange={onChange} label="selling mode" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith('sell');
  });

  it('stays readable and refuses to change when locked', () => {
    const onChange = vi.fn();
    render(<ModeSwitch mode="sell" onChange={onChange} locked label="selling mode" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('switch').getAttribute('aria-readonly')).toBe('true');
  });
});

describe('GlobalSearch', () => {
  it('submits what was typed', () => {
    const onSearch = vi.fn();
    render(<GlobalSearch placeholder="Search" label="Search" onSearch={onSearch} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'KMT-88213' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(onSearch).toHaveBeenCalledWith('KMT-88213');
  });

  it('focuses on `/`, and leaves `/` alone while typing in a field', () => {
    render(
      <>
        <GlobalSearch placeholder="Search" label="Search" onSearch={() => {}} />
        <input aria-label="Other" />
      </>,
    );
    const search = screen.getByRole('searchbox', { name: 'Search' });
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(search);

    const other = screen.getByLabelText('Other');
    other.focus();
    fireEvent.keyDown(other, { key: '/' });
    expect(document.activeElement).toBe(other);
  });

  it('says how to reach it', () => {
    render(<GlobalSearch placeholder="Search" label="Search" onSearch={() => {}} />);
    expect(screen.getByText('press / to search')).toBeDefined();
  });
});

describe('SideNav collapse', () => {
  it('has no Collapse control on the plain SideNav, so D9’s Account rail is unchanged', () => {
    render(<SideNav brandLabel="Komtru" items={NAV} />);
    expect(screen.queryByRole('button', { name: /Collapse/ })).toBeNull();
  });

  it('narrows to an icon rail and back, keeping every destination reachable by name', () => {
    const { container } = render(<CollapsibleSideNav brandLabel="Komtru" items={NAV} />);
    const button = screen.getByRole('button', { name: 'Collapse navigation' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('aside')?.className).toContain('w-[180px]');

    fireEvent.click(button);
    const expand = screen.getByRole('button', { name: 'Expand navigation' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('aside')?.className).toContain('w-[64px]');
    expect(screen.getByRole('link', { name: 'Trades' }).getAttribute('title')).toBe('Trades');
  });
});

describe('TopNav and ResponsiveAppShell tools', () => {
  it('draws actions at the right of the tablet top nav', () => {
    render(<TopNav brandLabel="Komtru" items={NAV} actions={<button type="button">Act</button>} />);
    expect(screen.getByRole('button', { name: 'Act' })).toBeDefined();
  });

  it('draws the search and the actions in a desktop-only bar above the content', () => {
    const { container } = render(
      <ResponsiveAppShell
        tabs={NAV}
        search={<input aria-label="Find" />}
        actions={<button type="button">Act</button>}
      >
        <h1>Page</h1>
      </ResponsiveAppShell>,
    );
    const bar = screen.getByLabelText('Find').closest('[data-shell-toolbar]');
    expect(bar?.className).toMatch(/\bhidden\b.*\blg:flex\b/);
    expect(container.querySelectorAll('main')).toHaveLength(1);
    // The same actions ride the tablet nav, so they are present twice and each is hidden at the other width.
    expect(screen.getAllByRole('button', { name: 'Act' })).toHaveLength(2);
  });
});
