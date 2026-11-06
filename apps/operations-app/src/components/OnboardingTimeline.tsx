import { cx } from '@komtru/ui-kit';
import type { Step } from '../auth/welcome';

/**
 * `.m-timeline` — the six steps down the left of OP-28. Done is an emerald node with a tick, the
 * active step an indigo ring, the rest hairline circles with their text dimmed to half, exactly as
 * the reference draws them. The vertical rule between nodes is the step's own `::before`.
 */
export function OnboardingTimeline({ steps }: { steps: readonly Step[] }): React.JSX.Element {
  return (
    <ol
      aria-label="Your first day"
      className="m-0 list-none rounded-md border border-solid border-border-hairline bg-surface-primary p-[14px]"
    >
      {steps.map((step, index) => (
        <li
          key={step.title}
          aria-current={step.state === 'active' ? 'step' : undefined}
          className={cx(
            'relative flex gap-[10px] pb-[16px] last:pb-0',
            index < steps.length - 1 &&
              "before:absolute before:top-[20px] before:bottom-0 before:left-[8px] before:w-[2px] before:bg-border-hairline before:content-['']",
          )}
        >
          <span
            aria-hidden
            className={cx(
              'z-[1] flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full',
              step.state === 'done' && 'bg-trust-emerald',
              step.state === 'active' && 'border-[4px] border-solid border-trust-indigo bg-pure-white',
              step.state === 'pending' && 'border-[2px] border-solid border-border-hairline bg-pure-white',
            )}
          >
            {step.state === 'done' && (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth={2.6}
                strokeLinecap="round"
                className="h-[10px] w-[10px]"
              >
                <path d="M5 12.5l4 4 10-10" />
              </svg>
            )}
          </span>
          <span className={cx(step.state === 'pending' && 'opacity-50')}>
            <b className="block text-[12.5px]">{step.title}</b>
            <span className="block text-[11px] text-slate">
              {step.state === 'done' && <span className="sr-only">Done. </span>}
              {step.detail}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
