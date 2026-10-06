'use client';

import { cx } from '../primitives/cx.js';
import { FOCUS_RING } from '../primitives/focus.js';
import { SearchIcon } from './icons.js';

export interface FilterChip {
  id: string;
  label: string;
  active?: boolean;
}

export interface FilterBarSearch {
  /** The accessible name. Visually hidden: the reference labels the field with its placeholder. */
  label: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
}

export interface FilterBarProps {
  search?: FilterBarSearch;
  chips?: readonly FilterChip[];
  onChipToggle?: (id: string) => void;
  /** Names the chip group. */
  label?: string;
  /** Anything else that belongs on the bar — a `PeriodFilter`, a status menu. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * `.filter-bar` — a search field and a row of filter chips above a `DataTable`.
 *
 * The chips are `aria-pressed` toggle buttons inside a named group, because the reference's queue
 * filters really are independent ("Flagged (6)", "New buyer (11)", "Cleared (204)" can all be on).
 * Mutually exclusive filters are a different control and live in `PeriodFilter`, which is a radio
 * group — five `aria-pressed` toggles would tell a screen reader there are five independent
 * switches when there is really one choice.
 */
export function FilterBar({
  search,
  chips,
  onChipToggle,
  label = 'Filters',
  children,
  className,
}: FilterBarProps): React.JSX.Element {
  return (
    <div className={cx('mb-[16px] flex flex-wrap items-center gap-[10px]', className)}>
      {search !== undefined && (
        // The label wraps the input, so the pair needs no generated id and the bar stays usable in
        // a list of identical bars.
        <label className="relative block min-w-[200px] flex-1">
          <span className="sr-only">{search.label}</span>
          <span
            aria-hidden
            className="absolute left-[12px] top-[50%] h-[15px] w-[15px] [transform:translateY(-50%)] stroke-trust-gray"
          >
            <SearchIcon />
          </span>
          <input
            type="search"
            {...(search.placeholder === undefined ? {} : { placeholder: search.placeholder })}
            {...(search.value === undefined ? {} : { value: search.value })}
            {...(search.onChange === undefined
              ? {}
              : { onChange: (event) => search.onChange?.(event.target.value) })}
            className={cx(
              'w-full rounded-sm border-[1.5px] border-solid border-border-hairline bg-surface-elevated py-[9px] pl-[36px] pr-[12px] font-body text-[13px] text-midnight-text',
              FOCUS_RING,
            )}
          />
        </label>
      )}

      {chips !== undefined && chips.length > 0 && (
        <div role="group" aria-label={label} className="flex flex-wrap items-center gap-[10px]">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-pressed={chip.active ?? false}
              onClick={() => onChipToggle?.(chip.id)}
              className={cx(
                'inline-flex cursor-pointer items-center gap-[5px] whitespace-nowrap rounded-full border-[1.5px] border-solid py-[7px] px-[12px] text-[12px] font-semibold',
                chip.active === true
                  ? 'border-trust-indigo bg-trust-indigo-soft text-info-on-soft'
                  : 'border-border-hairline bg-surface-elevated text-midnight-text',
                FOCUS_RING,
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {children}
    </div>
  );
}
