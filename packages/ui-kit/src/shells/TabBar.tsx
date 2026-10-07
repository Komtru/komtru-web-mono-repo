import { cx } from '../primitives/cx.js';
import { FOCUS_RING } from '../primitives/focus.js';
import { type NavItem, soleCurrent } from './NavItem.js';

export interface TabBarProps {
  items: readonly NavItem[];
  /** Names the landmark. A screen with two navigations needs them told apart. */
  label?: string;
  /**
   * The shell's own visibility, which is the shell's decision, not the nav's — the same reason
   * `<SideNav>` and `<TopNav>` take one. An app that draws one responsive shell rather than two
   * hides the tab bar from `md` up, where the top nav takes over.
   */
  className?: string;
}

/**
 * `.scr-tabbar` — the bottom tab bar. `margin-top:auto` is what pins it to the bottom of a short
 * screen, so it only works inside `<MobileShell>`'s flex column.
 */
export function TabBar({ items, label = 'Sections', className }: TabBarProps): React.JSX.Element {
  const current = soleCurrent(items, 'TabBar');

  return (
    <nav
      aria-label={label}
      className={cx(
        'sticky bottom-0 mt-auto flex border-t-[1px] border-t-border-hairline bg-surface-primary',
        'pt-[8px] pr-[4px] pb-[12px] pl-[4px]',
        className,
      )}
    >
      {items.map((item, index) => {
        const active = index === current;
        const content = (
          <>
            {/* The reference strokes `.tab svg` and colours `.tab span` with their own rules, not
                through the tab, so the two states are stated where the reference states them. */}
            <span
              aria-hidden
              className={cx('h-[19px] w-[19px]', active ? 'stroke-trust-indigo' : 'stroke-trust-gray')}
            >
              {item.icon}
            </span>
            <span
              className={cx(
                'text-[9px]',
                active ? 'font-bold text-trust-indigo' : 'font-medium text-trust-gray',
              )}
            >
              {item.label}
            </span>
          </>
        );
        const tabClass = cx('flex flex-1 flex-col items-center gap-[3px]', FOCUS_RING);

        return item.href === undefined ? (
          <button
            key={item.label}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={item.onSelect}
            className={tabClass}
          >
            {content}
          </button>
        ) : (
          <a
            key={item.label}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={tabClass}
          >
            {content}
          </a>
        );
      })}
    </nav>
  );
}
