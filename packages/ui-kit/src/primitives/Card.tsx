import { cx } from './cx.js';

/**
 * `row` is the reference's `.item-card` exactly — thumbnail beside copy, 12px gap, 16px of air under
 * it. `stack` is the same chrome with the reference's other card padding and no row layout, which is
 * what `.logistics-card`, `.m-profile-card` and `.fee-summary` all are.
 */
export type CardLayout = 'row' | 'stack';

const LAYOUTS: Record<CardLayout, string> = {
  row: 'flex gap-[12px] p-[12px] mb-[16px]',
  stack: 'block p-[14px] mb-[16px]',
};

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  layout?: CardLayout;
}

export function Card({ layout = 'stack', className, ...rest }: CardProps): React.JSX.Element {
  return (
    <div
      {...rest}
      className={cx(
        'rounded-md border border-solid border-border-hairline bg-surface-primary',
        LAYOUTS[layout],
        className,
      )}
    />
  );
}
