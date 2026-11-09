import { cx } from './cx.js';

export type VersionStepState = 'done' | 'active' | 'pending';

export interface VersionStep {
  id: string;
  title: string;
  detail?: string;
  state: VersionStepState;
}

const NODE: Record<VersionStepState, string> = {
  done: 'bg-trust-emerald',
  active: 'bg-info shadow-[0_0_0_3px_var(--trust-indigo-soft)]',
  pending: 'bg-stone-gray',
};

/**
 * `.m-step` — the short vertical timeline TC-06 draws for the versions of an agreement: a node per
 * step joined by a rail, ticked once done. An ordered list, because the order is the history.
 */
export function VersionTimeline({
  steps,
  className,
  'aria-label': ariaLabel,
}: {
  steps: readonly VersionStep[];
  className?: string;
  'aria-label'?: string;
}): React.JSX.Element {
  return (
    <ol
      {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
      className={cx('m-0 list-none p-0', className)}
    >
      {steps.map((step, index) => (
        <li key={step.id} className="relative flex gap-[10px] pb-[16px] last:pb-0">
          {index < steps.length - 1 && (
            <span
              aria-hidden
              className="absolute bottom-0 left-[8px] top-[20px] w-[2px] bg-border-hairline"
            />
          )}
          <span
            aria-hidden
            className={cx(
              'z-[1] flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[50%]',
              NODE[step.state],
            )}
          >
            {step.state === 'done' && (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="2.6"
                strokeLinecap="round"
                className="h-[10px] w-[10px] stroke-pure-white"
              >
                <path d="M5 12.5l4 4 10-10" />
              </svg>
            )}
          </span>
          <div className="text-[12.5px]">
            <b className="block">{step.title}</b>
            {step.detail !== undefined && <span className="text-[11px] text-slate">{step.detail}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
