'use client';

import { useId } from 'react';
import { cx } from '../primitives/cx.js';
import { FOCUS_RING } from '../primitives/focus.js';

export type ShellMode = 'buy' | 'sell';

export interface ModeSwitchProps {
  mode: ShellMode;
  onChange?: (mode: ShellMode) => void;
  /** Names the group ("Buy or sell mode"). */
  label: string;
  /**
   * A certified merchant is sell-only: the switch stays readable on Sell and refuses to change,
   * the way the reference shows a locked setting rather than hiding it.
   */
  locked?: boolean;
  /** Why it is locked, read out as the description of both options. Only drawn when `locked`. */
  lockedReason?: string;
  className?: string;
}

const OPTIONS: readonly { mode: ShellMode; text: string }[] = [
  { mode: 'buy', text: 'Buy' },
  { mode: 'sell', text: 'Sell' },
];

/**
 * v2's Buy/Sell switch (`.role-toggle`, Y2, DX-03, DX-04): a two-option segmented control that says
 * which view of the one account the person is in. Two buttons in a group, the current one pressed.
 *
 * The v2 stylesheet carries no `.role-toggle` rule, so it is drawn from the tokens the neighbouring
 * chips use: indigo-soft for Buy, emerald-soft for Sell. Locked, the options use `aria-disabled`
 * rather than `disabled` so they stay focusable and the reason can be read.
 */
export function ModeSwitch({
  mode,
  onChange,
  label,
  locked = false,
  lockedReason,
  className,
}: ModeSwitchProps): React.JSX.Element {
  const reasonId = useId();
  const showReason = locked && lockedReason !== undefined;

  return (
    <div
      role="group"
      aria-label={label}
      className={cx(
        'inline-flex items-center gap-[2px] rounded-full bg-surface-secondary p-[2px] text-[12px] font-semibold',
        locked && 'opacity-[.7]',
        className,
      )}
    >
      {OPTIONS.map((option) => {
        const pressed = option.mode === mode;
        return (
          <button
            key={option.mode}
            type="button"
            aria-pressed={pressed}
            aria-disabled={locked ? true : undefined}
            aria-describedby={showReason ? reasonId : undefined}
            onClick={locked || pressed ? undefined : () => onChange?.(option.mode)}
            className={cx(
              'rounded-full pt-[5px] pr-[12px] pb-[5px] pl-[12px]',
              pressed
                ? option.mode === 'sell'
                  ? 'bg-trust-emerald-soft text-trust-emerald'
                  : 'bg-trust-indigo-soft text-info-on-soft'
                : 'bg-transparent text-slate',
              FOCUS_RING,
            )}
          >
            {option.text}
          </button>
        );
      })}
      {showReason && (
        <span id={reasonId} className="sr-only">
          {lockedReason}
        </span>
      )}
    </div>
  );
}
