import { tradeCodeSchema } from '@komtru/shared-types';

// The app's navigation, as data.
//
// One account (design C22, §6.3). v2 draws two views of it behind a Buy/Sell switch, five
// destinations each (DX-03 and DX-04); a certified merchant is sell-only, so they are always in Sell.
// Account carries **Payouts** once someone has sold, and a **Park Agent** item whose destination is
// the hub application, the application's status, or `park.komtru.com`.
//
// No React here: what the destinations are is a rule, and a rule is worth testing without a DOM.
// `icons.tsx` draws them.

/** Where someone stands with Park, which decides what the Account item opens (design §7.6). */
export type ParkAgentState = 'none' | 'pending' | 'active';

export interface Viewer {
  /** Holds an `ACTIVE` `MERCHANT` capability: sell-only, and `canActAsBuyer` is false (§6.3). */
  certifiedMerchant: boolean;
  /** Has been the seller on at least one trade. Not "is a merchant" — a casual seller has payouts too. */
  hasSold: boolean;
  parkAgent: ParkAgentState;
}

/**
 * What the shell assumes before anything has resolved who is looking: no merchant certification, no
 * sales, no hub. Every variation adds a destination, so the anonymous shell is the smallest one and
 * nothing appears that the person turns out not to have.
 */
export const ANONYMOUS_VIEWER: Viewer = { certifiedMerchant: false, hasSold: false, parkAgent: 'none' };

/** v2's Buy/Sell switch (Y2, DX-03, DX-04). Two views of one account, not two accounts. */
export type Mode = 'buy' | 'sell';

export const MODE_COOKIE = 'komtru_mode';

export type TabId = 'home' | 'trades' | 'messages' | 'discover' | 'account' | 'shop' | 'orders' | 'listings';

export interface Tab {
  id: TabId;
  label: string;
  href: string;
}

const TAB: Record<TabId, Tab> = {
  home: { id: 'home', label: 'Home', href: '/home' },
  trades: { id: 'trades', label: 'Trades', href: '/trades' },
  messages: { id: 'messages', label: 'Messages', href: '/messages' },
  // The v2 mobile nav links Discover to `/browse`.
  discover: { id: 'discover', label: 'Discover', href: '/browse' },
  account: { id: 'account', label: 'Account', href: '/account' },
  shop: { id: 'shop', label: 'Shop', href: '/shop' },
  orders: { id: 'orders', label: 'Orders', href: '/orders' },
  listings: { id: 'listings', label: 'Listings', href: '/listings' },
};

/** Alerts left the nav in v2: it is the bell in the top bar. */
export const BELL_HREF = '/alerts';

/**
 * The five destinations of a mode, in the order v2 draws them: DX-03's sidebar for Buy and DX-04's for
 * Sell. The viewer is part of the signature because the mode it is in is decided with it (`modeFor`).
 */
export function tabsFor(_viewer: Viewer, mode: Mode = 'buy'): readonly Tab[] {
  return mode === 'sell'
    ? [TAB.shop, TAB.orders, TAB.listings, TAB.messages, TAB.account]
    : [TAB.home, TAB.trades, TAB.messages, TAB.discover, TAB.account];
}

/**
 * The mode someone is in: the one they chose (a cookie the switch writes), Buy when they have not
 * chosen or the value is not a mode. A certified merchant is sell-only (design 6.3), so for them the
 * answer is Sell whatever the cookie says and the switch is locked.
 */
export function modeFor(viewer: Viewer, chosen: string | undefined): Mode {
  if (viewer.certifiedMerchant) return 'sell';
  return chosen === 'sell' ? 'sell' : 'buy';
}

/** Where switching into a mode lands: the first item of its nav. */
export const landingFor = (mode: Mode): string => tabsFor(ANONYMOUS_VIEWER, mode)[0]?.href ?? '/home';

/**
 * Where `/` goes: the landing screen of the mode the person is in. The cookie is a view preference
 * only (a certified merchant lands on Sell whatever it says).
 *
 * TODO(T-111): buyer routes must be rejected on the server when the session says
 * `canActAsBuyer === false`. The chrome locks a certified merchant to Sell; it does not authorise.
 */
export const rootDestination = (viewer: Viewer, chosen: string | undefined): string =>
  landingFor(modeFor(viewer, chosen));

const YEAR_SECONDS = 60 * 60 * 24 * 365;

/** The `document.cookie` string for a chosen mode: Lax, and Secure anywhere but plain-http localhost. */
export const modeCookie = (mode: Mode, secure: boolean): string =>
  `${MODE_COOKIE}=${mode}; path=/; max-age=${YEAR_SECONDS}; samesite=lax${secure ? '; secure' : ''}`;

/**
 * Where the global search and Trade Code bar sends a query: a Trade Code goes to that code's own page,
 * which opens the trade for a party or the person it invited (and says "no trade found for you" to
 * anyone else); anything else is Discover's results; an empty query goes nowhere. A code is only put
 * in the path in its canonical `KMT-<digits>-NG` form, which `tradeCodeSchema` produces from what was
 * typed, so no input can name another route or host. Everything else is encoded as a query value.
 */
export function searchDestination(query: string): string | undefined {
  const text = query.trim();
  if (text === '') return undefined;
  const code = tradeCodeSchema.safeParse(text);
  if (code.success) return `/trades/${code.data}`;
  return `/browse?q=${encodeURIComponent(text)}`;
}

const isSegmentPrefix = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * Which tab a path sits under, or `undefined` when it sits under none — a Park Hub application, the
 * alerts feed, or a destination of the other mode. Whole segments only: `/tradesmanship` is not the
 * Trades tab, and `aria-current="page"` on the wrong tab is worse than on none.
 */
export function currentTab(pathname: string, viewer: Viewer, mode: Mode = 'buy'): TabId | undefined {
  return tabsFor(viewer, mode).find((tab) => isSegmentPrefix(pathname, tab.href))?.id;
}

export type AccountItemId =
  | 'personal-info'
  | 'verification'
  | 'trust-history'
  | 'notifications'
  | 'security'
  | 'payouts'
  | 'park-agent';

export interface AccountItem {
  id: AccountItemId;
  label: string;
  href: string;
  /** Leaves this app, so the link is drawn as leaving it. */
  external?: true;
  /** The right-hand line on the row: what state this section is in, when it has one. */
  status?: string;
}

export interface AccountLinks {
  /** `park.komtru.com`, from the environment. */
  parkUrl: string;
}

const PARK_AGENT: Record<ParkAgentState, Omit<AccountItem, 'id' | 'label'>> = {
  none: { href: '/hub/register', status: 'Not yet set up' },
  pending: { href: '/hub/application', status: 'Application in review' },
  // The only external destination in Account: an active agent's operating screens are a different
  // app with a different session scope (design C12, §7.6).
  active: { href: '', external: true, status: 'Active' },
};

/**
 * D9's five sections, then the two that depend on the person.
 *
 * Payouts on `hasSold` alone, as the ticket says, and not on certification: a casual seller has
 * money to collect, and a merchant who has not sold yet already gave a payout account during
 * certification, so there is nothing for them to do here until the first sale completes.
 */
export function accountItemsFor(viewer: Viewer, links: AccountLinks): readonly AccountItem[] {
  const items: AccountItem[] = [
    { id: 'personal-info', label: 'Personal info', href: '/account/personal-info' },
    { id: 'verification', label: 'Verification', href: '/account/verification' },
    { id: 'trust-history', label: 'Trust history', href: '/account/trust-history' },
    { id: 'notifications', label: 'Notifications', href: '/account/notifications' },
    { id: 'security', label: 'Security', href: '/account/security' },
  ];

  if (viewer.hasSold) items.push({ id: 'payouts', label: 'Payouts', href: '/account/payouts' });

  const park = PARK_AGENT[viewer.parkAgent];
  items.push({
    id: 'park-agent',
    label: 'Park Agent',
    ...park,
    href: park.external === true ? links.parkUrl : park.href,
  });

  return items;
}
