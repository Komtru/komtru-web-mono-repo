import { cx } from './cx.js';
import { FOCUS_RING } from './focus.js';

export interface TabNavItem {
  id: string;
  label: string;
  href: string;
}

export interface TabNavProps {
  items: readonly TabNavItem[];
  /** The `id` of the tab being shown. */
  current: string;
  'aria-label': string;
  className?: string;
}

/**
 * A strip of links that are views of the same thing, one of them current. Each tab is a page of its own (so
 * it has a URL, the back button works and a tab can be linked to), which is why these are links and not
 * `role="tab"` controls: a tablist promises one page with panels that swap, and this is not that.
 */
export function TabNav({
  items,
  current,
  className,
  'aria-label': ariaLabel,
}: TabNavProps): React.JSX.Element {
  return (
    <nav aria-label={ariaLabel} className={cx('mb-[14px]', className)}>
      <ul className="m-0 flex list-none gap-[4px] rounded-md bg-surface-secondary p-[3px]">
        {items.map((item) => {
          const active = item.id === current;
          return (
            <li key={item.id} className="flex-1">
              <a
                href={item.href}
                {...(active ? { 'aria-current': 'page' as const } : {})}
                className={cx(
                  'block rounded-[6px] px-[6px] py-[7px] text-center text-[12px] font-semibold',
                  active ? 'bg-surface-primary text-midnight-text shadow-sm' : 'text-slate',
                  FOCUS_RING,
                )}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
