import { CollapsibleSideNav } from '../primitives/CollapsibleSideNav.js';
import { LogoBar } from './LogoBar.js';
import type { NavItem } from './NavItem.js';
import { TabBar, type TabBarAction } from './TabBar.js';
import { TopNav } from './TopNav.js';

export interface ResponsiveAppShellProps {
  /** The bottom tab bar below `md`, and what the rail falls back to. */
  tabs: readonly NavItem[];
  /**
   * What the bottom tab bar lists when it is not every tab. The consumer app drops Discover there to
   * make room for the raised Start Trade action (owner ruling 2026-11-20); the rail keeps it.
   */
  barTabs?: readonly NavItem[];
  /**
   * What the sidebar and the top nav list, when that is not the tabs. D9 does this: inside Account
   * the rail is headed "Account" and lists the account's sections instead of the app's tabs.
   */
  rail?: { label: string; items: readonly NavItem[] };
  /** Drawn at the top of the content, inside `<main>` — an offline banner, a flash message. */
  banner?: React.ReactNode;
  /** v2's global search and Trade Code bar: a bar above the content at `lg` and up (DX-03). */
  search?: React.ReactNode;
  /**
   * v2's right-hand tools — mode switch, bell, profile. At `lg` they sit at the right of the search
   * bar; from `md` to `lg` they ride the top nav (TX-02). Rendered in both, hidden at the other width.
   */
  actions?: React.ReactNode;
  /** The mobile header's tools, beside the brand. */
  mobileActions?: React.ReactNode;
  /**
   * The bottom tab bar's raised action (`TabBar`'s `action`). Mobile only: from `md` up the bar is
   * gone and the screens keep their own buttons.
   */
  mobileAction?: TabBarAction;
  children?: React.ReactNode;
}

/**
 * One shell, three chromes, decided by the viewport and nothing else:
 *
 *   base → `md`   the mobile web page: brand row, scrolling body, bottom tab bar
 *   `md` → `lg`   tablet: the desktop shell with the sidebar collapsed to a top nav
 *   `lg` →        desktop: the 180px sidebar beside the content
 *
 * This is where a tabbed Komtru app gets its tablet behaviour, which is the reference's own rule
 * ("no bespoke tablet screens … top-nav instead of sidebar"). It lives here rather than in one app
 * so the other four do not each arrive at it again: it was written inside `web-app-ui`, where the
 * three apps that need the same thing could not reach it, and it had already drifted from
 * `MobileShell`'s and `DesktopShell`'s copies of the same numbers.
 *
 * **Why not `<MobileShell>` or `<DesktopShell>` per route.** A Next server does not know the
 * viewport width, so the alternatives are a client boundary around every screen with a mobile
 * first paint that snaps after hydration, or both shells in the markup — and since each of those
 * renders its own `<main>`, that puts the page's content, its landmark and every form control in
 * the document twice. Composing the navigations around one `<main>` keeps the content rendered
 * once: all three navigations are in the DOM, but a navigation holds five links and no state, and
 * at any width the other two are `display:none`, so they are out of the accessibility tree rather
 * than merely invisible. The three carry distinct names because a person only ever meets one of
 * them while a test and an audit meet all three at once.
 *
 * Those two shells stay as they are: a flow screen with a sticky footer and a public page still
 * want them, and neither has a second chrome to switch to.
 */
export function ResponsiveAppShell({
  tabs,
  barTabs,
  rail,
  banner,
  search,
  actions,
  mobileActions,
  mobileAction,
  children,
}: ResponsiveAppShellProps): React.JSX.Element {
  const railLabel = rail?.label ?? 'Komtru';
  const railItems = rail?.items ?? tabs;

  return (
    <div className="flex min-h-dvh flex-col bg-surface-secondary md:bg-surface-primary lg:flex-row">
      {/* `.scr-logo-row`, the mobile brand row. The tablet and desktop navigations carry the brand
          themselves, so from `md` up this would be a second one. */}
      <LogoBar className="md:hidden" {...(mobileActions === undefined ? {} : { tools: mobileActions })} />

      <div className="hidden md:block lg:hidden">
        <TopNav
          brandLabel={railLabel}
          items={railItems}
          label="Sections menu"
          {...(actions === undefined ? {} : { actions })}
        />
      </div>

      <CollapsibleSideNav
        brandLabel={railLabel}
        items={railItems}
        label="Sections sidebar"
        className="hidden lg:block"
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {(search !== undefined || actions !== undefined) && (
          <div data-shell-toolbar className="hidden items-center gap-[12px] px-[24px] pt-[18px] lg:flex">
            {search}
            {actions !== undefined && <div className="ml-auto flex items-center gap-[8px]">{actions}</div>}
          </div>
        )}
        {/* `.scr-body`'s 16px and its 90px of bottom clearance for the tab bar, stepping to
            `.tweb-content`'s 20px and `.dweb-content`'s 24px where the tab bar is gone. */}
        <main className="flex-1 p-[16px] pb-[90px] md:p-[20px] lg:p-[24px]">
          {banner}
          {children}
        </main>
        <TabBar
          items={barTabs ?? tabs}
          label="Sections"
          className="md:hidden"
          {...(mobileAction === undefined ? {} : { action: mobileAction })}
        />
      </div>
    </div>
  );
}
