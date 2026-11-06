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
 * `.komtru-mobile-nav` (v2) — the bottom tab bar: a translucent blurred surface with a lifted
 * shadow, one equal column per item, and an indigo-soft pill behind the current one. T-110 drew
 * v1's `.scr-tabbar`; T-222 re-based it. `margin-top:auto` is what pins it to the bottom of a
 * short screen, so it only works inside `<MobileShell>`'s flex column.
 */
export function TabBar({ items, label = 'Sections', className }: TabBarProps): React.JSX.Element {
  const current = soleCurrent(items, 'TabBar');

  return (
    <nav
      aria-label={label}
      className={cx(
        'sticky bottom-0 z-20 mt-auto grid shrink-0 grow-0 basis-auto grid-flow-col auto-cols-fr gap-[4px]',
        'pt-[8px] pr-[8px] pb-[calc(8px+env(safe-area-inset-bottom,0px))] pl-[8px]',
        'border-t-[1px] border-t-border-hairline bg-[rgba(255,255,255,.97)]',
        '[box-shadow:0_-6px_18px_rgba(13,20,32,.045)] [backdrop-filter:blur(12px)]',
        className,
      )}
    >
      {items.map((item, index) => {
        const active = index === current;
        const content = (
          <>
            {/* v2 sets `stroke="currentColor"` on each glyph; a caller's icon does not, so the
                wrapper hands the item's colour down. */}
            <span aria-hidden className="h-[20px] w-[20px] shrink-0 grow-0 basis-auto stroke-current">
              {item.icon}
            </span>
            <span>{item.label}</span>
          </>
        );
        // v2's resting colour is #7A8496, which no token carries (`trust-gray` is the lighter
        // #9AA5B8 and `slate` the darker #4C5568), so it is written as the reference writes it and
        // `tabbar-parity.test.tsx` holds it to the reference.
        const tabClass = cx(
          'flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-[4px] rounded-[12px] no-underline',
          'text-[9.5px] font-semibold tracking-[.01em] transition-[background-color,color] duration-150 ease-[ease]',
          'motion-reduce:transition-none',
          // eslint-disable-next-line komtru-design/no-raw-hex -- v2's #7A8496 has no token; see above.
          active ? 'bg-trust-indigo-soft text-trust-indigo' : 'bg-transparent text-[#7A8496]',
          FOCUS_RING,
        );

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
