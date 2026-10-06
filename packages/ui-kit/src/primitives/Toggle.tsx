'use client';

import { cx } from './cx.js';
import { FOCUS_RING } from './focus.js';

export interface ToggleProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  /** Settings rows put the visible text beside the switch, so the switch itself needs a name. */
  label: string;
  /**
   * `.m-switch.locked` — "Dispute & fraud alerts: always on, every channel". The reference shows the
   * state rather than hiding the row, so the control stays readable and refuses to change.
   */
  locked?: boolean;
  className?: string;
}

/** `.m-switch` — 34×20 track, 16px knob, emerald when on. */
export function Toggle({
  checked,
  onChange,
  label,
  locked = false,
  className,
}: ToggleProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-readonly={locked ? true : undefined}
      onClick={locked ? undefined : () => onChange?.(!checked)}
      className={cx(
        'relative h-[20px] w-[34px] shrink-0 rounded-full border-none',
        // One branch, not two: class order in the attribute does not decide the cascade, stylesheet
        // order does, and Tailwind emits `.bg-stone-gray` before `.bg-trust-emerald`. Listing both
        // on a locked-and-on switch — which is the only locked switch the reference draws — would
        // have rendered it emerald, the opposite of `.m-switch.locked`.
        locked ? 'bg-stone-gray opacity-[.6]' : checked ? 'bg-trust-emerald' : 'bg-stone-gray',
        FOCUS_RING,
        className,
      )}
    >
      <span
        aria-hidden
        className={cx(
          'absolute top-[2px] left-[2px] h-[16px] w-[16px] rounded-[50%] bg-pure-white',
          'transition-transform duration-[150ms] motion-reduce:transition-none',
          checked && 'translate-x-[14px]',
        )}
      />
    </button>
  );
}
