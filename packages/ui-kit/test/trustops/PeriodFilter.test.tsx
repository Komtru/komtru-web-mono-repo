// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PERIODS, PeriodFilter, type Period } from '../../src/index.js';
import '../primitives/setup.js';
import { expectFocusRing } from '../primitives/setup.js';
import { expectNoAxeViolations } from './axe.js';

function filter(overrides: Partial<React.ComponentProps<typeof PeriodFilter>> = {}) {
  const onChange = vi.fn();
  const result = render(
    <main>
      <PeriodFilter value="week" onChange={onChange} {...overrides} />
    </main>,
  );
  return { ...result, onChange };
}

const group = () => screen.getByRole('radiogroup', { name: 'Period' });

describe('PeriodFilter — lifetime is not a period', () => {
  it('offers exactly the five windows the reference draws', () => {
    filter();
    expect(
      within(group())
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['This week', 'Month', 'Quarter', 'Year', 'Custom range']);
  });

  it('never offers lifetime as a sixth option', () => {
    filter({ lifetime: { label: 'Lifetime intake', value: '84,216' } });
    expect(PERIODS.map((period) => period.id as string)).not.toContain('lifetime');
    for (const radio of within(group()).getAllByRole('radio')) {
      expect(radio.textContent?.toLowerCase()).not.toContain('lifetime');
    }
    expect(within(group()).queryByText(/lifetime/i)).toBeNull();
  });

  it('shows the lifetime figure outside the group, under its own label', () => {
    filter({ lifetime: { label: 'Lifetime intake', value: '84,216' } });
    const figure = screen.getByText('84,216');
    expect(group().contains(figure)).toBe(false);
    expect(figure.closest('p')?.textContent).toBe('Lifetime intake: 84,216');
    expect(figure.className).toContain('font-mono');
  });

  it('shows no lifetime figure when a screen has none to show', () => {
    filter();
    expect(screen.queryByText(/lifetime/i)).toBeNull();
  });
});

describe('PeriodFilter', () => {
  it('marks exactly one option checked', () => {
    filter({ value: 'quarter' });
    const radios = within(group()).getAllByRole('radio');
    expect(radios.filter((radio) => radio.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Quarter' }).getAttribute('aria-checked')).toBe('true');
  });

  it('is one tab stop: only the selected option is tabbable', () => {
    filter({ value: 'year' });
    const radios = within(group()).getAllByRole('radio');
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, -1, -1, 0, -1]);
  });

  it('reports a click', () => {
    const { onChange } = filter();
    fireEvent.click(screen.getByRole('radio', { name: 'Month' }));
    expect(onChange).toHaveBeenCalledWith('month');
  });

  it.each([
    ['ArrowRight', 'week', 'month', 'Month'],
    ['ArrowDown', 'week', 'month', 'Month'],
    ['ArrowLeft', 'week', 'custom', 'Custom range'],
    ['ArrowUp', 'month', 'week', 'This week'],
    ['Home', 'quarter', 'week', 'This week'],
    ['End', 'week', 'custom', 'Custom range'],
  ])('moves with %s, and focus follows the committed selection', (key, from, expected, label) => {
    // A real parent: the component is controlled, so focus can only follow once `value` comes back.
    function Controlled() {
      const [period, setPeriod] = useState<Period>(from as Period);
      return <PeriodFilter value={period} onChange={setPeriod} />;
    }
    render(
      <main>
        <Controlled />
      </main>,
    );
    const current = within(group())
      .getAllByRole('radio')
      .find((radio) => radio.tabIndex === 0);
    if (current === undefined) throw new Error('no tabbable radio');
    fireEvent.keyDown(current, { key });
    const moved = screen.getByRole('radio', { name: label });
    expect(moved.getAttribute('aria-checked')).toBe('true');
    expect(moved.tabIndex).toBe(0);
    expect(document.activeElement).toBe(moved);
    expect(PERIODS[PERIODS.findIndex((period) => period.id === expected)]?.label).toBe(label);
  });

  /**
   * Focusing straight from the key handler would leave the keyboard on a radio with `tabIndex={-1}`
   * whenever a controlled parent rejected or debounced the change, and the group would then have
   * two tab stops disagreeing with each other.
   */
  it('leaves focus alone when the parent declines the change', () => {
    const { onChange } = filter({ value: 'week' });
    const first = screen.getByRole('radio', { name: 'This week' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('month');
    expect(document.activeElement).toBe(first);
    expect(first.tabIndex).toBe(0);
    expect(screen.getByRole('radio', { name: 'Month' }).tabIndex).toBe(-1);
  });

  it('does not steal focus when the period changes for some other reason', () => {
    const { rerender } = render(
      <main>
        <button type="button">Elsewhere</button>
        <PeriodFilter value="week" onChange={() => undefined} />
      </main>,
    );
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.focus();
    rerender(
      <main>
        <button type="button">Elsewhere</button>
        <PeriodFilter value="year" onChange={() => undefined} />
      </main>,
    );
    expect(document.activeElement).toBe(elsewhere);
  });

  it('ignores a key that is not part of the radio-group contract', () => {
    const { onChange } = filter();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'This week' }), { key: 'a' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the custom range only while custom is the choice', () => {
    const custom = <span>1 Sep – 30 Sep</span>;
    const { rerender, onChange } = filter({ customRange: custom });
    expect(screen.queryByText('1 Sep – 30 Sep')).toBeNull();
    rerender(
      <main>
        <PeriodFilter value="custom" onChange={onChange} customRange={custom} />
      </main>,
    );
    expect(screen.getByText('1 Sep – 30 Sep')).toBeDefined();
  });

  it('carries the keyboard ring', () => {
    filter();
    expectFocusRing(screen.getByRole('radio', { name: 'This week' }));
  });

  it('takes a name for the group', () => {
    filter({ label: 'Intake period' });
    expect(screen.getByRole('radiogroup', { name: 'Intake period' })).toBeDefined();
  });

  it('passes axe', async () => {
    const { container } = filter({ lifetime: { label: 'Lifetime intake', value: '84,216' } });
    await expectNoAxeViolations(container);
  });
});
