'use client';

import { useRef } from 'react';
import { cx } from '../primitives/cx.js';
import { FOCUS_RING } from '../primitives/focus.js';

/**
 * The five period filters the reference draws (TO-PA7 line 8281, TO-PA8 line 8295).
 *
 * `lifetime` is deliberately **not** a member. The reference is explicit about why: "Selected period
 * controls period metrics. Lifetime intake remains all-time." Lifetime is not a narrower or wider
 * window, it is the absence of one, and a hub's lifetime intake has to stay readable while the
 * reviewer is looking at this week. Making it a sixth option would let a screen silently swap one
 * for the other.
 */
export type Period = 'week' | 'month' | 'quarter' | 'year' | 'custom';

export const PERIODS: readonly { id: Period; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year', label: 'Year' },
  { id: 'custom', label: 'Custom range' },
];

export interface PeriodFilterProps {
  value: Period;
  onChange: (period: Period) => void;
  /** Names the radio group. */
  label?: string;
  /** Rendered outside the group, with its own label, because lifetime is not a period. */
  lifetime?: { label: string; value: string };
  /** The date pair, shown only while `custom` is selected. */
  customRange?: React.ReactNode;
  className?: string;
}

/**
 * `.filter-chip` as a radio group.
 *
 * Five mutually exclusive choices are a `radiogroup`, not five toggle buttons: a reader arriving at
 * a toggle hears "pressed/not pressed" five times and has to infer that only one can be on, where a
 * radio group announces "Period, This week, 1 of 5". It carries the radio-group keyboard contract
 * too — one tab stop, arrows to move, Home/End to the ends — which is also how the chips stop
 * costing five tab presses to walk past.
 */
export function PeriodFilter({
  value,
  onChange,
  label = 'Period',
  lifetime,
  customRange,
  className,
}: PeriodFilterProps): React.JSX.Element {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (index: number) => {
    const period = PERIODS[index];
    if (period === undefined) return;
    onChange(period.id);
    buttons.current[index]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = PERIODS.length - 1;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        move(index === last ? 0 : index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        move(index === 0 ? last : index - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(last);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className={cx('flex flex-wrap items-center gap-[10px]', className)}>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-[10px]">
        {PERIODS.map((period, index) => {
          const selected = period.id === value;
          return (
            <button
              key={period.id}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              // Roving tabindex: the group is one tab stop, and arrows move inside it.
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(period.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cx(
                'inline-flex cursor-pointer items-center gap-[5px] whitespace-nowrap rounded-full border-[1.5px] border-solid py-[7px] px-[12px] text-[12px] font-semibold',
                selected
                  ? 'border-trust-indigo bg-trust-indigo-soft text-info-on-soft'
                  : 'border-border-hairline bg-surface-elevated text-midnight-text',
                FOCUS_RING,
              )}
            >
              {period.label}
            </button>
          );
        })}
      </div>

      {lifetime !== undefined && (
        <p className="text-[11px] text-slate">
          {`${lifetime.label}: `}
          <b className="font-mono text-midnight-text">{lifetime.value}</b>
        </p>
      )}

      {value === 'custom' && customRange}
    </div>
  );
}
