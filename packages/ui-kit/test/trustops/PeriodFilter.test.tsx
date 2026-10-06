// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
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
    ['ArrowRight', 'week', 'month'],
    ['ArrowDown', 'week', 'month'],
    ['ArrowLeft', 'week', 'custom'],
    ['ArrowUp', 'month', 'week'],
    ['Home', 'quarter', 'week'],
    ['End', 'week', 'custom'],
  ])('moves with %s', (key, from, expected) => {
    const { onChange } = filter({ value: from as Period });
    const current = within(group())
      .getAllByRole('radio')
      .find((radio) => radio.tabIndex === 0);
    if (current === undefined) throw new Error('no tabbable radio');
    fireEvent.keyDown(current, { key });
    expect(onChange).toHaveBeenCalledWith(expected);
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
