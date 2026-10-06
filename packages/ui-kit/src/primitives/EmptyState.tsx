import { cx } from './cx.js';

/** `.state-panel.empty` is an invitation; `.state-panel.error` is a recovery. */
export type EmptyStateTone = 'empty' | 'error';

const ICON_TONES: Record<EmptyStateTone, string> = {
  empty: 'bg-info-soft text-info-on-soft',
  error: 'bg-risk-soft text-risk-on-soft',
};

export interface EmptyStateProps {
  tone?: EmptyStateTone;
  icon?: React.ReactNode;
  /** Explains what is not here. "No protected Trades yet". */
  title: string;
  /** Names the benefit of acting. "every completed Trade adds to your Trust Profile". */
  body: string;
  /** The way out. The reference always gives one, and usually a quieter second. */
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
}

/**
 * `.state-panel` — explain, then benefit, then action, in that order. An empty screen in the
 * reference is never a shrug; it is the only screen that gets to say what the product is for.
 */
export function EmptyState({
  tone = 'empty',
  icon,
  title,
  body,
  action,
  secondaryAction,
  className,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cx(
        'flex flex-col items-center gap-[10px] rounded-lg border border-solid border-border-hairline',
        'bg-surface-primary py-[48px] px-[24px] text-center',
        className,
      )}
    >
      {icon !== undefined && (
        <div
          aria-hidden
          className={cx('flex h-[52px] w-[52px] items-center justify-center rounded-[50%]', ICON_TONES[tone])}
        >
          {icon}
        </div>
      )}
      <h4 className="max-w-[240px] text-[15px] font-semibold">{title}</h4>
      <p className="max-w-[240px] text-[12.5px] leading-[1.6] text-slate">{body}</p>
      {(action !== undefined || secondaryAction !== undefined) && (
        <div className="mt-[6px] flex w-full flex-col gap-[8px]">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
