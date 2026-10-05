import { cx } from './cx.js';

/** The five states the reference's `.chip` carries, each with its own soft/on-soft pair. */
export type ChipTone = 'protected' | 'awaiting' | 'risk' | 'resolved' | 'verified';

const TONES: Record<ChipTone, string> = {
  protected: 'text-success-on-soft bg-success-soft',
  awaiting: 'text-warning-on-soft bg-warning-soft',
  risk: 'text-risk-on-soft bg-risk-soft',
  resolved: 'text-success-on-soft bg-success-soft',
  verified: 'text-success-on-soft bg-success-soft',
};

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone: ChipTone;
  /** The reference draws the leading dot on every chip inside a trade row. */
  dot?: boolean;
}

export function Chip({ tone, dot = true, className, children, ...rest }: ChipProps): React.JSX.Element {
  return (
    <span
      {...rest}
      className={cx(
        'inline-flex items-center gap-[6px] rounded-full py-[5px] px-[10px] text-[11px] font-semibold',
        TONES[tone],
        className,
      )}
    >
      {dot && (
        // The reference sets the dot inline to the chip's own `--…-on-soft`; `bg-current` is that
        // colour by definition, and keeps the pairing from drifting apart.
        <i aria-hidden className="h-[6px] w-[6px] rounded-[50%] bg-current" />
      )}
      {children}
    </span>
  );
}
