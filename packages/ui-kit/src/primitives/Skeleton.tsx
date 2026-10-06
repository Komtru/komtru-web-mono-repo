import { cx } from './cx.js';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `.skel-line` widths the reference draws: 40%, 60%, 80%, or the full width. */
  width?: 'w40' | 'w60' | 'w80' | 'full';
  /** Stacked placeholder lines rather than one block. */
  lines?: number;
}

const WIDTHS = {
  w40: 'w-[40%]',
  w60: 'w-[60%]',
  w80: 'w-[80%]',
  full: 'w-full',
} as const;

const SHIMMER =
  'bg-[linear-gradient(90deg,var(--stone-gray)_25%,var(--cloud-gray)_50%,var(--stone-gray)_75%)] ' +
  'bg-[length:200%_100%] animate-[shimmer_1.6s_ease-in-out_infinite] motion-reduce:animate-none';

/**
 * `.skeleton` — the shimmer the reference uses while a screen's real content is on its way. Hidden
 * from assistive technology: the loading state itself is announced by `<NodeLoader>`, which names
 * the wait, so a screen reader hears one message instead of a wall of empty boxes.
 */
export function Skeleton({ width = 'full', lines, className, ...rest }: SkeletonProps): React.JSX.Element {
  if (lines !== undefined) {
    return (
      <div {...rest} aria-hidden>
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            className={cx('mb-[8px] h-[12px] rounded-[6px]', SHIMMER, WIDTHS[width], className)}
          />
        ))}
      </div>
    );
  }
  return (
    <div {...rest} aria-hidden className={cx('h-[12px] rounded-[6px]', SHIMMER, WIDTHS[width], className)} />
  );
}
