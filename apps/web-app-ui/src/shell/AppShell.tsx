import { ResponsiveAppShell, type NavItem, type TabBarAction } from '@komtru/ui-kit';
import { OfflineStatus } from './OfflineStatus';
import { BELL_ICON, PLUS_ICON, TAB_ICONS } from './icons';
import { BELL_HREF, tabsFor, type Mode, type TabId, type Viewer } from './nav';
import { ModeControl, SearchBar } from './ShellTools';

/**
 * This app's five destinations, in `@komtru/ui-kit`'s responsive shell, with v2's top bar tools: global
 * search, the Buy/Sell switch, the bell and the profile. The switch picks which five destinations are
 * drawn (F-083); the side of each new trade is still chosen on Start Trade.
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
  /** Buy or Sell (`resolveMode`). Defaults to Buy, which is what a static page such as OF1 draws. */
  mode?: Mode;
  /**
   * Replaces the app's own destinations in the sidebar and the top nav. D9 does this: inside
   * Account the rail is headed "Account" and lists the account's sections, not the app's tabs.
   */
  nav?: { label: string; items: readonly NavItem[] };
  children: React.ReactNode;
}

/** Mobile's raised action. Start Trade asks which side the person is on (`SideChoice`). */
/** Mobile's raised action. Start Trade asks which side the person is on, with their mode's side picked. */
const START_TRADE_ACTION: TabBarAction = { label: 'Start a trade', href: '/trade/new', icon: PLUS_ICON };

/**
 * A screen names the tab it belongs to in Buy terms or Sell terms. In the other mode it is marked as that
 * mode's counterpart: a trade opened from Sell's Orders is under Orders, the same trade from Buy under Trades.
 */
const COUNTERPART: Partial<Record<TabId, TabId>> = {
  trades: 'orders',
  orders: 'trades',
  home: 'shop',
  shop: 'home',
  payouts: 'account',
};

/** The tab mobile's bottom bar gives up for the raised Start Trade action: the rail keeps all five. */
const OFF_THE_BAR: Record<Mode, TabId> = { buy: 'discover', sell: 'payouts' };

export function AppShell({ tab, viewer, mode = 'buy', nav, children }: AppShellProps): React.JSX.Element {
  const all = tabsFor(viewer, mode);
  const marked =
    tab === undefined || all.some((item) => item.id === tab)
      ? tab
      : all.find((item) => item.id === COUNTERPART[tab])?.id;
  const toNav = (item: (typeof all)[number]): NavItem => ({
    label: item.label,
    href: item.href,
    icon: TAB_ICONS[item.id],
    ...(item.id === marked ? { current: true } : {}),
  });
  const tabs = all.map(toNav);
  // Mobile's bottom bar: one tab makes room for the raised Start Trade action (owner ruling
  // 2026-11-20), leaving four tabs with the action in the middle. Payouts stays one tap away in Account.
  const barTabs = all.filter((item) => item.id !== OFF_THE_BAR[mode]).map(toNav);

  const actions = (
    <>
      <ModeControl mode={mode} />
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
      mobileActions={<ModeControl mode={mode} />}
      rail={nav}
      banner={<OfflineStatus />}
      search={<SearchBar />}
      actions={actions}
    >
      {children}
    </ResponsiveAppShell>
  );
}
