import { cx } from '../primitives/cx.js';
import { FOCUS_RING } from '../primitives/focus.js';
import { type NavItem, soleCurrent } from './NavItem.js';

export interface TabBarProps {
  items: readonly NavItem[];
  /** Names the landmark. A screen with two navigations needs them told apart. */
  label?: string;
}

/**
 * `.scr-tabbar` — the bottom tab bar. `margin-top:auto` is what pins it to the bottom of a short
 * screen, so it only works inside `<MobileShell>`'s flex column.
 */
export function TabBar({ items, label = 'Sections' }: TabBarProps): React.JSX.Element {
  const current = soleCurrent(items, 'TabBar');

  return (
    <nav
      aria-label={label}
      className="sticky bottom-0 mt-auto flex border-t-[1px] border-t-border-hairline bg-surface-primary pt-[8px] pr-[4px] pb-[12px] pl-[4px]"
    >
      {items.map((item, index) => {
        const active = index === current;
        const content = (
          <>
            {/* The reference strokes `.tab svg` and colours `.tab span` separately but always to the
                same token; routing both through `color` keeps them from drifting apart. */}
            <span aria-hidden className="h-[19px] w-[19px] stroke-current">
              {item.icon}
            </span>
            <span className={cx('text-[9px]', active ? 'font-bold' : 'font-medium')}>{item.label}</span>
          </>
        );
        const className = cx(
          'flex flex-1 flex-col items-center gap-[3px]',
          active ? 'text-trust-indigo' : 'text-trust-gray',
          FOCUS_RING,
        );

        return item.href === undefined ? (
          <button
            key={item.label}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={item.onSelect}
            className={className}
          >
            {content}
          </button>
        ) : (
          <a
            key={item.label}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={className}
          >
            {content}
          </a>
        );
      })}
    </nav>
  );
}
