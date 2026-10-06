import { cx } from './cx.js';

export interface StepperProps {
  steps: readonly string[];
  /** 0-based index of the step the person is on. */
  current: number;
  label?: string;
  className?: string;
}

/**
 * `.ko-stepper` — the numbered rail above a multi-step form. The reference numbers the dots, so the
 * sequence is real content rather than decoration, and the active step carries `aria-current`.
 */
export function Stepper({ steps, current, label = 'Progress', className }: StepperProps): React.JSX.Element {
  if (!Number.isInteger(current) || current < 0 || current >= steps.length) {
    throw new RangeError(`current must be 0–${steps.length - 1}, got ${String(current)}`);
  }
  return (
    <ol aria-label={label} className={cx('m-0 mb-[18px] flex items-center', className)}>
      {steps.map((step, index) => (
        <li key={step} className="flex items-center">
          <span
            {...(index === current ? { 'aria-current': 'step' as const } : {})}
            className={cx(
              'flex items-center gap-[7px] text-[9px] font-[650]',
              index === current ? 'text-midnight-text' : 'text-slate',
            )}
          >
            <span
              className={cx(
                'grid h-[22px] w-[22px] place-items-center rounded-[50%] border border-solid text-[8px]',
                index === current
                  ? 'border-trust-indigo bg-trust-indigo text-pure-white'
                  : 'border-border-hairline bg-surface-primary',
              )}
            >
              {index + 1}
            </span>
            {step}
          </span>
          {index < steps.length - 1 && (
            <span aria-hidden className="m-0 mx-[7px] h-[1px] w-[32px] bg-border-hairline" />
          )}
        </li>
      ))}
    </ol>
  );
}
