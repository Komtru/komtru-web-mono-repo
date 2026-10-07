import { ResponsiveAppShell, type NavItem } from '@komtru/ui-kit';
import { OfflineStatus } from './OfflineStatus';
import { TAB_ICONS } from './icons';
import { tabsFor, type TabId, type Viewer } from './nav';

/**
 * This app's five destinations, in `@komtru/ui-kit`'s responsive shell.
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

export function AppShell({ tab, viewer, nav, children }: AppShellProps): React.JSX.Element {
  const tabs = tabsFor(viewer).map<NavItem>((item) => ({
    label: item.label,
    href: item.href,
    icon: TAB_ICONS[item.id],
    ...(item.id === tab ? { current: true } : {}),
  }));

  return (
    <ResponsiveAppShell tabs={tabs} rail={nav} banner={<OfflineStatus />}>
      {children}
    </ResponsiveAppShell>
  );
}
