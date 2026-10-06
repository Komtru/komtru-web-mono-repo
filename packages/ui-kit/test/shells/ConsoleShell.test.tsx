// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConsoleShell } from '../../src/index.js';
import '../primitives/setup.js';

const ICON = <svg aria-hidden viewBox="0 0 24 24" />;
const NAV = [
  { label: 'Overview', icon: ICON, href: '/ops' },
  { label: 'Dispute Queue', icon: ICON, href: '/ops/disputes' },
  { label: 'Park Agents', icon: ICON, href: '/ops/park-agents', current: true },
];

describe('ConsoleShell', () => {
  it('keeps every destination reachable by name once the labels are hidden', () => {
    // `.ko-dweb-sidebar.collapsed .ko-dweb-item > span:not(:first-child){display:none}` hides every
    // label. A rail of bare glyphs has no accessible name unless the control carries one itself.
    render(<ConsoleShell collapsed nav={NAV} title="All Park Hubs" />);
    for (const item of NAV) {
      const link = screen.getByRole('link', { name: item.label });
      expect(link.getAttribute('title')).toBe(item.label);
    }
  });

  it('is a 68px rail that grows to 228px at lg', () => {
    const { container } = render(<ConsoleShell nav={NAV} title="Park Agents" />);
    const aside = container.querySelector('aside')?.className ?? '';
    expect(aside).toContain('w-[68px]');
    expect(aside).toContain('lg:w-[228px]');
  });

  it('stays a rail at every width when a person collapses it', () => {
    const { container } = render(<ConsoleShell collapsed nav={NAV} title="Park Agents" />);
    const aside = container.querySelector('aside')?.className ?? '';
    expect(aside).toContain('w-[68px]');
    expect(aside).not.toContain('lg:w-[228px]');
  });

  it('hides the labels below lg and shows them again at lg', () => {
    render(<ConsoleShell nav={NAV} title="Park Agents" />);
    const label = screen.getByRole('link', { name: 'Overview' }).lastElementChild;
    expect(label?.className.split(/\s+/)).toContain('hidden');
    expect(label?.className).toContain('lg:inline');
  });

  it('keeps the labels hidden at lg too when collapsed', () => {
    render(<ConsoleShell collapsed nav={NAV} title="Park Agents" />);
    const label = screen.getByRole('link', { name: 'Overview' }).lastElementChild;
    expect(label?.className).not.toContain('lg:inline');
  });

  it('marks one destination current and refuses two', () => {
    const { container } = render(<ConsoleShell nav={NAV} title="Park Agents" />);
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    const two = NAV.map((item) => ({ ...item, current: true }));
    expect(() => render(<ConsoleShell nav={two} title="Park Agents" />)).toThrow(RangeError);
  });

  it('never lets a hover background beat the current destination’s pill', () => {
    // Tailwind emits `hover:` after the base utilities, so a hover background on the active item
    // would win — the reverse of the reference, where `:hover` is declared before `.active`.
    render(<ConsoleShell nav={NAV} title="Park Agents" />);
    expect(screen.getByRole('link', { name: 'Park Agents' }).className).not.toContain('hover:bg-');
    expect(screen.getByRole('link', { name: 'Overview' }).className).toContain('hover:bg-surface-secondary');
  });

  it('gives the page its one top-level heading', () => {
    render(<ConsoleShell nav={NAV} title="Park Agents" description="Applications and custody." />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Park Agents');
    expect(screen.getByText('Applications and custody.')).toBeDefined();
  });

  it('omits the description line rather than drawing an empty one', () => {
    const { container } = render(<ConsoleShell nav={NAV} title="Park Agents" />);
    expect(container.querySelector('header p')).toBeNull();
  });

  it('puts the screen’s actions in the page head, not in the rail', () => {
    const { container } = render(
      <ConsoleShell nav={NAV} title="Park Agents" actions={<button type="button">+ Register</button>} />,
    );
    expect(container.querySelector('header')?.textContent).toContain('+ Register');
    expect(container.querySelector('aside')?.textContent).not.toContain('+ Register');
  });

  it('draws the hairline only when the rail has a footer under it', () => {
    const { container, rerender } = render(<ConsoleShell nav={NAV} title="Park Agents" />);
    expect(container.querySelector('aside .bg-border-hairline')).toBeNull();
    rerender(<ConsoleShell nav={NAV} title="Park Agents" navFooter={<span>Collapse</span>} />);
    expect(container.querySelector('aside .bg-border-hairline')).not.toBeNull();
  });

  it('defaults to the staff lockup', () => {
    render(<ConsoleShell nav={NAV} title="Park Agents" />);
    expect(screen.getByText('Komtru Ops')).toBeDefined();
  });

  it('has no gallery frame', () => {
    const { container } = render(<ConsoleShell nav={NAV} title="Park Agents" />);
    expect(container.firstElementChild?.className).toContain('min-h-dvh');
    expect(container.firstElementChild?.className).not.toContain('min-h-[620px]');
  });
});
