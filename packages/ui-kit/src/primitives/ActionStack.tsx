import { cx } from './cx.js';

/**
 * The screen's actions, stacked, in the flow of the page. The reference pins them with `.btn-sticky`
 * above a tab bar that is not drawn on these screens; inside the app shell the tab bar is real, so a
 * pinned footer would sit on top of it. The order is the reference's: the action first, the way out last.
 */
export function ActionStack({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return <div className={cx('mt-[20px] flex flex-col gap-[8px]', className)}>{children}</div>;
}
