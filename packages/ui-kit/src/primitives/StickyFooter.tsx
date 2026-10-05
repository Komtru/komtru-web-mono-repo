import { cx } from './cx.js';

/**
 * `.btn-sticky` — the footer that holds a screen's real actions. The reference writes the column
 * layout and 8px gap inline on every instance that holds more than one button, so it is baked in.
 */
export function StickyFooter({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      {...rest}
      className={cx(
        'sticky bottom-0 mt-auto flex flex-col gap-[8px] py-[14px] px-[16px]',
        'bg-[linear-gradient(to_top,var(--surface-primary)_70%,transparent)]',
        className,
      )}
    />
  );
}
