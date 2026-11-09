import { cx } from './cx.js';
import { FOCUS_RING } from './focus.js';

export interface OptionCardProps {
  /** One radio group's name; the cards sharing it are the options. */
  name: string;
  value: string;
  checked: boolean;
  /** Read the choice from `event.target.value`; the card forwards the radio's own handler untouched. */
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  children: React.ReactNode;
  /** A line under the label saying what choosing it means. */
  description?: string;
  disabled?: boolean;
}

/**
 * `.reason-option` — a choice drawn as a bordered row with a dot. A real radio under it, so the
 * keyboard, the screen reader and the group semantics are the browser's and not re-made here.
 */
export function OptionCard({
  name,
  value,
  checked,
  onChange,
  children,
  description,
  disabled = false,
}: OptionCardProps): React.JSX.Element {
  return (
    <label
      className={cx(
        'mb-[8px] flex cursor-pointer items-start gap-[10px] rounded-md border-[1.5px] border-solid bg-surface-primary p-[12px] text-[12.5px]',
        'has-[:focus-visible]:outline-[2.5px] has-[:focus-visible]:outline-trust-indigo has-[:focus-visible]:outline-offset-[2px]',
        checked ? 'border-trust-indigo bg-trust-indigo-soft' : 'border-border-hairline',
        disabled && 'cursor-not-allowed opacity-55',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className={cx('peer sr-only', FOCUS_RING)}
      />
      <span
        aria-hidden
        className={cx(
          'mt-[1px] h-[16px] w-[16px] shrink-0 rounded-[50%] border-[1.5px] border-solid',
          checked ? 'border-[5px] border-trust-indigo bg-pure-white' : 'border-trust-gray',
        )}
      />
      <span>
        <span className="block font-semibold">{children}</span>
        {description !== undefined && (
          <span className="mt-[2px] block text-[11px] text-slate">{description}</span>
        )}
      </span>
    </label>
  );
}
