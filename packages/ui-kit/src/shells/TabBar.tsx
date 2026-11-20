import { Fragment } from 'react';
import { cx } from '../primitives/cx.js';
import { FOCUS_RING } from '../primitives/focus.js';
import { type NavItem, soleCurrent } from './NavItem.js';

/** The tab bar's one raised action: a link, drawn as a brand-blue circle in the middle of the bar. */
export interface TabBarAction {
  /** The accessible name and the caption under the circle. */
  label: string;
  href: string;
  /** Strokes in `currentColor`, which is white on the circle. */
  icon: React.ReactNode;
}

export interface TabBarProps {
  items: readonly NavItem[];
  /**
   * A primary action set in the middle of the bar (owner ruling 2026-11-20: Start Trade on mobile).
   * It is not a destination, so it is never current: the circle floats half above the bar, over the
   * content, and its caption sits on the bar's baseline with the tab labels.
   */
  action?: TabBarAction;
  /**
   * `sticky` (the default) rides `<MobileShell>`'s flex column: `margin-top:auto` holds it at the
   * bottom of a short screen. `fixed` pins it to the bottom of the screen itself, which
   * `<ResponsiveAppShell>` uses (2026-11-20): in a mobile browser with a bottom toolbar (Brave and
   * Safari on iOS) a `min-h-dvh` page can be taller than what shows, so a sticky bar was drawn above
   * a strip of empty page and scrolling to it pushed the header off the top. The caller then owns
   * the bottom clearance of its content.
   */
  pinned?: 'sticky' | 'fixed';
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
export function TabBar({
  items,
  label = 'Sections',
  action,
  pinned = 'sticky',
  className,
}: TabBarProps): React.JSX.Element {
  const current = soleCurrent(items, 'TabBar');
  // In the middle: with five tabs, two on its left and three on its right.
  const actionAt = Math.floor(items.length / 2);

  return (
    <nav
      aria-label={label}
      className={cx(
        pinned === 'fixed' ? 'fixed inset-x-0 bottom-0' : 'sticky bottom-0 mt-auto',
        'z-20 grid shrink-0 grow-0 basis-auto grid-flow-col auto-cols-fr gap-[4px]',
        'pt-[8px] pr-[8px] pb-[calc(8px+env(safe-area-inset-bottom,0px))] pl-[8px]',
        'border-t-[1px] border-t-border-hairline bg-[rgba(255,255,255,.97)]',
        '[box-shadow:0_-6px_18px_rgba(13,20,32,.045)] [backdrop-filter:blur(12px)]',
        className,
      )}
    >
      {items.map((item, index) => {
        const active = index === current;
        const before =
          action !== undefined && index === actionAt ? (
            <ActionSlot key="tabbar-action" action={action} />
          ) : null;
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

        const tab =
          item.href === undefined ? (
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
        return before === null ? (
          tab
        ) : (
          <Fragment key={item.label}>
            {before}
            {tab}
          </Fragment>
        );
      })}
      {action !== undefined && actionAt >= items.length && <ActionSlot action={action} />}
    </nav>
  );
}

/**
 * The raised action's column: a bare 52px brand-blue circle with a plus, no caption (owner,
 * 2026-11-20). The column keeps the bar's rhythm; the circle is lifted so its centre sits on the
 * bar's top edge — half over the content, half in the bar — with a white ring that reads as a notch
 * in the bar's border. With no visible text, `aria-label` is the link's name.
 */
function ActionSlot({ action }: { action: TabBarAction }): React.JSX.Element {
  return (
    <a
      href={action.href}
      aria-label={action.label}
      className={cx('group relative flex min-h-[48px] min-w-0 rounded-[12px] no-underline', FOCUS_RING)}
    >
      <span
        aria-hidden
        data-tabbar-action-circle
        className={cx(
          // The bar has 8px of top padding, so -8px puts the circle's centre on the bar's edge.
          'absolute left-1/2 top-[-8px] flex h-[52px] w-[52px] -translate-x-1/2 -translate-y-1/2 items-center justify-center',
          'rounded-full border-[4px] border-solid border-pure-white bg-trust-indigo text-pure-white',
          '[box-shadow:0_6px_16px_rgba(13,20,32,.18)] transition-transform duration-150 ease-[ease]',
          'group-active:scale-95 motion-reduce:transition-none',
        )}
      >
        <span className="h-[22px] w-[22px] stroke-current">{action.icon}</span>
      </span>
    </a>
  );
}
