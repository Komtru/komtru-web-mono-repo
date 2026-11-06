import { ResponsiveAppShell, type NavItem } from '@komtru/ui-kit';
import { OfflineStatus } from './OfflineStatus';
import { BELL_ICON, TAB_ICONS } from './icons';
import { BELL_HREF, tabsFor, type Mode, type TabId, type Viewer } from './nav';
import { ModeControl, SearchBar } from './ShellTools';

/**
 * This app's five destinations for the mode someone is in, in `@komtru/ui-kit`'s responsive shell, with
 * v2's top bar tools: global search, the Buy/Sell switch, the bell and the profile.
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
  /** Buy or Sell (`modeFor`). Defaults to Buy, which is what a static page such as OF1 draws. */
  mode?: Mode;
  /**
   * Replaces the app's own destinations in the sidebar and the top nav. D9 does this: inside
   * Account the rail is headed "Account" and lists the account's sections, not the app's tabs.
   */
  nav?: { label: string; items: readonly NavItem[] };
  children: React.ReactNode;
}

export function AppShell({ tab, viewer, mode = 'buy', nav, children }: AppShellProps): React.JSX.Element {
  const tabs = tabsFor(viewer, mode).map<NavItem>((item) => ({
    label: item.label,
    href: item.href,
    icon: TAB_ICONS[item.id],
    ...(item.id === tab ? { current: true } : {}),
  }));

  const actions = (
    <>
      <ModeControl mode={mode} locked={viewer.certifiedMerchant} />
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
      rail={nav}
      banner={<OfflineStatus />}
      search={<SearchBar />}
      actions={actions}
      mobileActions={<ModeControl mode={mode} locked={viewer.certifiedMerchant} />}
    >
      {children}
    </ResponsiveAppShell>
  );
}
