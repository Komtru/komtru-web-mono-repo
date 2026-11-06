// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CollapsibleSideNav,
  GlobalSearch,
  ModeSwitch,
  ResponsiveAppShell,
  SideNav,
  TopNav,
} from '../../src/index.js';
import '../primitives/setup.js';

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // storage unavailable: nothing to clear
  }
});

const ICON = <svg aria-hidden viewBox="0 0 24 24" />;
const NAV = [
  { label: 'Home', icon: ICON, href: '/home', current: true },
  { label: 'Trades', icon: ICON, href: '/trades' },
];

describe('ModeSwitch (v2 `.role-toggle`)', () => {
  it('is a two-option segmented control: a group of two buttons, one pressed', () => {
    const { rerender } = render(<ModeSwitch mode="buy" onChange={() => {}} label="Buy or sell mode" />);
    expect(screen.getByRole('group', { name: 'Buy or sell mode' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Buy' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Sell' }).getAttribute('aria-pressed')).toBe('false');
    rerender(<ModeSwitch mode="sell" onChange={() => {}} label="Buy or sell mode" />);
    expect(screen.getByRole('button', { name: 'Buy' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Sell' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('asks for the mode that was pressed, and not for the one already on', () => {
    const onChange = vi.fn();
    render(<ModeSwitch mode="buy" onChange={onChange} label="Buy or sell mode" />);
    fireEvent.click(screen.getByRole('button', { name: 'Buy' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));
    expect(onChange).toHaveBeenCalledWith('sell');
  });

  it('stays readable, refuses to change and says why when locked', () => {
    const onChange = vi.fn();
    render(
      <ModeSwitch
        mode="sell"
        onChange={onChange}
        locked
        label="Buy or sell mode"
        lockedReason="Certified merchants sell only"
      />,
    );
    const buy = screen.getByRole('button', { name: 'Buy' });
    fireEvent.click(buy);
    expect(onChange).not.toHaveBeenCalled();
    expect(buy.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Sell' }).getAttribute('aria-pressed')).toBe('true');
    expect(buy.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByRole('group').textContent).toContain('Certified merchants sell only');
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

  it('ignores `/` with a modifier held', () => {
    render(<GlobalSearch placeholder="Search" label="Search" onSearch={() => {}} />);
    for (const modifier of ['metaKey', 'ctrlKey', 'altKey']) {
      fireEvent.keyDown(document.body, { key: '/', [modifier]: true });
      expect(document.activeElement).toBe(document.body);
    }
  });

  it('names the landmark apart from the field, and hides the hint from readers', () => {
    render(<GlobalSearch placeholder="Search" label="Search" onSearch={() => {}} />);
    expect(screen.getByRole('search', { name: 'Site search' })).toBeDefined();
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeDefined();
    expect(screen.getByText('press / to search').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('SideNav collapse', () => {
  it('has no Collapse control on the plain SideNav, so D9’s Account rail is unchanged', () => {
    render(<SideNav brandLabel="Komtru" items={NAV} />);
    expect(screen.queryByRole('button', { name: /Collapse/ })).toBeNull();
  });

  it('narrows to an icon rail and back, keeping every destination reachable by name', () => {
    const { container } = render(<CollapsibleSideNav brandLabel="Komtru" items={NAV} />);
    // One name for both states: `aria-expanded` says which one it is in.
    const button = screen.getByRole('button', { name: 'Collapse navigation' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('aside')?.className).toContain('w-[180px]');

    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('aside')?.className).toContain('w-[64px]');
    expect(screen.getByRole('link', { name: 'Trades' }).getAttribute('title')).toBe('Trades');
  });

  it('keeps focus on the button after collapsing', () => {
    render(<CollapsibleSideNav brandLabel="Komtru" items={NAV} />);
    const button = screen.getByRole('button', { name: 'Collapse navigation' });
    button.focus();
    fireEvent.click(button);
    expect(document.activeElement).toBe(button);
  });

  it('stays collapsed on the next screen, which draws a fresh shell', () => {
    const first = render(<CollapsibleSideNav brandLabel="Komtru" items={NAV} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    first.unmount();
    const { container } = render(<CollapsibleSideNav brandLabel="Komtru" items={NAV} />);
    expect(container.querySelector('aside')?.className).toContain('w-[64px]');
    expect(screen.getByRole('button', { name: 'Collapse navigation' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('survives storage being unavailable', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<CollapsibleSideNav brandLabel="Komtru" items={NAV} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(screen.getByRole('button', { name: 'Collapse navigation' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    get.mockRestore();
    set.mockRestore();
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
        mobileActions={<button type="button">Mode</button>}
      >
        <h1>Page</h1>
      </ResponsiveAppShell>,
    );
    const bar = screen.getByLabelText('Find').closest('[data-shell-toolbar]');
    expect(bar?.className).toMatch(/\bhidden\b.*\blg:flex\b/);
    expect(container.querySelectorAll('main')).toHaveLength(1);
    // The same actions ride the tablet nav, so they are present twice and each is hidden at the other width.
    const copies = screen.getAllByRole('button', { name: 'Act' });
    expect(copies).toHaveLength(2);
    for (const copy of copies) {
      expect(copy.closest('[class~="hidden"]')).not.toBeNull();
    }
  });

  it('puts the mobile tools in the mobile header only, hidden from md up', () => {
    render(
      <ResponsiveAppShell tabs={NAV} mobileActions={<button type="button">Mode</button>}>
        <h1>Page</h1>
      </ResponsiveAppShell>,
    );
    const mode = screen.getByRole('button', { name: 'Mode' });
    expect(mode.closest('header')?.className).toContain('md:hidden');
  });
});
