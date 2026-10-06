// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterBar } from '../../src/index.js';
import '../primitives/setup.js';
import { expectFocusRing } from '../primitives/setup.js';
import { expectNoAxeViolations } from './axe.js';

/** N1's own filters (reference line 3533). */
const CHIPS = [
  { id: 'flagged', label: 'Flagged (6)', active: true },
  { id: 'new-buyer', label: 'New buyer (11)' },
  { id: 'cleared', label: 'Cleared (204)' },
];

describe('FilterBar', () => {
  it('gives the search field a real label, not just a placeholder', () => {
    render(
      <FilterBar
        search={{ label: 'Search proposals', placeholder: 'Search by Trade Code, name, or phone' }}
      />,
    );
    const input = screen.getByRole('searchbox', { name: 'Search proposals' });
    expect(input.getAttribute('placeholder')).toBe('Search by Trade Code, name, or phone');
  });

  it('reports what was typed', () => {
    const onChange = vi.fn();
    render(<FilterBar search={{ label: 'Search proposals', value: '', onChange }} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'KMT-90138' } });
    expect(onChange).toHaveBeenCalledWith('KMT-90138');
  });

  it('puts the chips in a named group as independent toggles', () => {
    render(<FilterBar chips={CHIPS} />);
    const group = screen.getByRole('group', { name: 'Filters' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
  });

  it('reports which chip was toggled', () => {
    const onChipToggle = vi.fn();
    render(<FilterBar chips={CHIPS} onChipToggle={onChipToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cleared (204)' }));
    expect(onChipToggle).toHaveBeenCalledWith('cleared');
  });

  it('draws the active chip in the reference’s indigo pair', () => {
    render(<FilterBar chips={CHIPS} />);
    expect(screen.getByRole('button', { name: 'Flagged (6)' }).className).toContain('bg-trust-indigo-soft');
    expect(screen.getByRole('button', { name: 'Cleared (204)' }).className).toContain('bg-surface-elevated');
  });

  it('carries the keyboard ring on the field and on every chip', () => {
    render(<FilterBar search={{ label: 'Search proposals' }} chips={CHIPS} />);
    expectFocusRing(screen.getByRole('searchbox'));
    expectFocusRing(screen.getByRole('button', { name: 'New buyer (11)' }));
  });

  it('takes a name for the group when a screen carries more than one bar', () => {
    render(<FilterBar chips={CHIPS} label="Proposal filters" />);
    expect(screen.getByRole('group', { name: 'Proposal filters' })).toBeDefined();
  });

  it('renders whatever else belongs on the bar', () => {
    render(
      <FilterBar chips={CHIPS}>
        <span>Status</span>
      </FilterBar>,
    );
    expect(screen.getByText('Status')).toBeDefined();
  });

  it('draws no empty group when there are no chips', () => {
    render(<FilterBar search={{ label: 'Search proposals' }} />);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('passes axe', async () => {
    const { container } = render(
      <main>
        <FilterBar
          search={{ label: 'Search proposals', placeholder: 'Search by Trade Code' }}
          chips={CHIPS}
        />
      </main>,
    );
    await expectNoAxeViolations(container);
  });
});
