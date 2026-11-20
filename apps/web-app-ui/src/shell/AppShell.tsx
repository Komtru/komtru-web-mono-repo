import { ResponsiveAppShell, type NavItem, type TabBarAction } from '@komtru/ui-kit';
import { OfflineStatus } from './OfflineStatus';
import { BELL_ICON, PLUS_ICON, TAB_ICONS } from './icons';
import { BELL_HREF, tabsFor, type TabId, type Viewer } from './nav';
import { SearchBar } from './ShellTools';

/**
 * This app's five destinations, in `@komtru/ui-kit`'s responsive shell, with v2's top bar tools: global
 * search, the bell and the profile. There is no Buy/Sell switch (owner ruling 2026-11-20): which side
 * someone is on is chosen per trade, on Start Trade.
 *
 * The chrome itself — the mobile brand row and tab bar, the tablet top nav, the desktop sidebar,
 * and the single `<main>` they are composed around — is `<ResponsiveAppShell>`, so the four other
 * frontends get the same tablet behaviour rather than each arriving at it again. What stays here is
 * the part that is about Komtru's consumer app and nothing else: which tabs a viewer has, which of
 * them is current, and the offline banner.
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

/** Mobile's raised action. Start Trade asks which side the person is on (`SideChoice`). */
const START_TRADE_ACTION: TabBarAction = { label: 'Start a trade', href: '/trade/new', icon: PLUS_ICON };

export function AppShell({ tab, viewer, nav, children }: AppShellProps): React.JSX.Element {
  const all = tabsFor(viewer);
  const toNav = (item: (typeof all)[number]): NavItem => ({
    label: item.label,
    href: item.href,
    icon: TAB_ICONS[item.id],
    ...(item.id === tab ? { current: true } : {}),
  });
  const tabs = all.map(toNav);
  // Mobile's bottom bar: Discover makes room for the raised Start Trade action (owner ruling
  // 2026-11-20), leaving four tabs with the action in the middle. The rail keeps all five.
  const barTabs = all.filter((item) => item.id !== 'discover').map(toNav);

  const actions = (
    <>
      <a
        href={BELL_HREF}
        aria-label="Alerts"
        className="flex h-[32px] w-[32px] items-center justify-center rounded-full bg-surface-secondary"
      >
        <span aria-hidden className="h-[16px] w-[16px] stroke-midnight-text">
          {BELL_ICON}
        </span>
      </a>
      <a
        href="/account"
        aria-label="Your account"
        className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-trust-indigo-soft"
      >
        <span aria-hidden className="h-[16px] w-[16px] stroke-info-on-soft">
          {TAB_ICONS.account}
        </span>
      </a>
    </>
  );

  return (
    <ResponsiveAppShell
      tabs={tabs}
      barTabs={barTabs}
      mobileAction={START_TRADE_ACTION}
      rail={nav}
      banner={<OfflineStatus />}
      search={<SearchBar />}
      actions={actions}
    >
      {children}
    </ResponsiveAppShell>
  );
}
