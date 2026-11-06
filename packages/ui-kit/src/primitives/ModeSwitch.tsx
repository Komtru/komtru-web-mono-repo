'use client';

import { cx } from '../primitives/cx.js';
import { FOCUS_RING } from '../primitives/focus.js';

export type ShellMode = 'buy' | 'sell';

export interface ModeSwitchProps {
  mode: ShellMode;
  onChange?: (mode: ShellMode) => void;
  /** Names the switch for assistive technology; the visible text is only the current mode. */
  label: string;
  /**
   * A certified merchant is sell-only: the switch stays readable on Sell and refuses to change,
   * the way the reference shows a locked setting rather than hiding it.
   */
  locked?: boolean;
  className?: string;
}

/**
 * v2's Buy/Sell switch (`.role-toggle`, Y2, DX-03, DX-04): a pill that says which view of the one
 * account the person is in, with a knob that sits left for Buy and right for Sell.
 *
 * The v2 stylesheet carries no `.role-toggle` rule, so the pill is drawn from the tokens the
 * neighbouring chips and the Toggle use: indigo-soft for Buy, emerald-soft for Sell.
 */
export function ModeSwitch({
  mode,
  onChange,
  label,
  locked = false,
  className,
}: ModeSwitchProps): React.JSX.Element {
  const sell = mode === 'sell';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={sell}
      aria-label={label}
      aria-readonly={locked ? true : undefined}
      onClick={locked ? undefined : () => onChange?.(sell ? 'buy' : 'sell')}
      className={cx(
        'inline-flex items-center gap-[7px] rounded-full pt-[5px] pr-[8px] pb-[5px] pl-[12px] text-[12px] font-semibold',
        sell
          ? 'flex-row bg-trust-emerald-soft text-trust-emerald'
          : 'flex-row-reverse bg-trust-indigo-soft text-info-on-soft',
        locked && 'opacity-[.7]',
        FOCUS_RING,
        className,
      )}
    >
      <span>{sell ? 'Sell' : 'Buy'}</span>
      <i
        aria-hidden
        className={cx('block h-[14px] w-[14px] rounded-[50%]', sell ? 'bg-trust-emerald' : 'bg-trust-indigo')}
      />
    </button>
  );
}
