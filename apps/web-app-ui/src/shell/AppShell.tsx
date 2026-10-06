import { LogoBar, SideNav, TabBar, TopNav, type NavItem } from '@komtru/ui-kit';
import { OfflineStatus } from './OfflineStatus';
import { TAB_ICONS } from './icons';
import { tabsFor, type TabId, type Viewer } from './nav';

/**
 * The shell every signed-in screen is drawn in. One shell, three chromes, decided by the viewport
 * and nothing else:
 *
 *   base → `md`   the mobile web page: brand row, scrolling body, bottom tab bar
 *   `md` → `lg`   tablet: the desktop shell with the sidebar collapsed to a top nav
 *   `lg` →        desktop: the 180px sidebar beside the content
 *
 * **Why one shell and not `<MobileShell>` or `<DesktopShell>` per route.** A Next server does not
 * know the viewport width (`@komtru/app-kit`'s `layout.ts` sets this out), so the alternatives are a
 * client boundary around every screen with a mobile first paint that snaps after hydration, or both
 * shells in the markup with the page's content, its `<main>` landmark and every form control in the
 * document twice. Composing the navigations around one `<main>` keeps the content rendered once:
 * all three navigations are in the DOM, but a navigation holds five links and no state, and at any
 * width the other two are `display:none` — so they are out of the accessibility tree, not merely
 * invisible. The three carry distinct names ("Sections", "Sections menu", "Sections sidebar")
 * because a person only ever meets one of them, while a test and an audit meet all three at once.
 *
 * Tablet inherits the desktop shell, which is the reference's own rule ("no bespoke tablet screens
 * … top-nav instead of sidebar"), and this is where every later tablet screen gets that behaviour.
 */
export interface AppShellProps {
  /** Which of the five tabs this screen is under. `undefined` marks none of them. */
  tab?: TabId;
  viewer: Viewer;
  /**
   * Replaces the app's own destinations in the sidebar and the top nav. D9 does this: inside
   * Account the rail is headed "Account" and lists the account's sections, not the app's tabs.
   */
  nav?: { label: string; items: readonly NavItem[] };
  children: React.ReactNode;
}

export function AppShell({ tab, viewer, nav, children }: AppShellProps): React.JSX.Element {
  const tabs = tabsFor(viewer).map<NavItem>((item) => ({
    label: item.label,
    href: item.href,
    icon: TAB_ICONS[item.id],
    ...(item.id === tab ? { current: true } : {}),
  }));

  const railLabel = nav?.label ?? 'Komtru';
  const railItems = nav?.items ?? tabs;

  return (
    <div className="flex min-h-dvh flex-col bg-surface-secondary md:bg-surface-primary lg:flex-row">
      {/* `.scr-logo-row`, the mobile brand row. The tablet and desktop navigations carry the brand
          themselves, so from `md` up this would be a second one. */}
      <LogoBar className="md:hidden" />

      <div className="hidden md:block lg:hidden">
        <TopNav brandLabel={railLabel} items={railItems} label="Sections menu" />
      </div>

      <SideNav
        brandLabel={railLabel}
        items={railItems}
        label="Sections sidebar"
        className="hidden lg:block"
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* `.scr-body`'s 16px and its 90px of bottom clearance for the tab bar, stepping to
            `.tweb-content`'s 20px and `.dweb-content`'s 24px where the tab bar is gone. */}
        <main className="flex-1 p-[16px] pb-[90px] md:p-[20px] lg:p-[24px]">
          <OfflineStatus />
          {children}
        </main>
        <TabBar items={tabs} label="Sections" className="md:hidden" />
      </div>
    </div>
  );
}
