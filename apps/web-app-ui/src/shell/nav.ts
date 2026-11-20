import { tradeCodeSchema } from '@komtru/shared-types';

// The app's navigation, as data.
//
// One account, one navigation (owner ruling 2026-11-20). There are no buyer accounts and seller
// accounts: anyone buys and sells, and which side they are on is chosen per trade, on Start Trade.
// v2's Buy/Sell switch and its Sell-mode destinations (Shop, Orders, Listings) are gone.
// Account carries **Payouts** once someone has sold, and a **Park Agent** item whose destination is
// the hub application, the application's status, or `park.komtru.com`.
//
// No React here: what the destinations are is a rule, and a rule is worth testing without a DOM.
// `icons.tsx` draws them.

/** Where someone stands with Park, which decides what the Account item opens (design §7.6). */
export type ParkAgentState = 'none' | 'pending' | 'active';

export interface Viewer {
  /** Holds an `ACTIVE` `MERCHANT` capability, which lifts the selling limit. Merchants buy too. */
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

export type TabId = 'home' | 'trades' | 'messages' | 'discover' | 'account';

export interface Tab {
  id: TabId;
  label: string;
  href: string;
}

const TAB: Record<TabId, Tab> = {
  home: { id: 'home', label: 'Home', href: '/home' },
  trades: { id: 'trades', label: 'Trades', href: '/trades' },
  messages: { id: 'messages', label: 'Messages', href: '/messages' },
  // Discover is the search and find-a-trade surface (F-015). The v2 nav links it to `/browse`, but the browse
  // catalogue is deferred with the listings, so the tab goes to search instead.
  discover: { id: 'discover', label: 'Discover', href: '/search' },
  account: { id: 'account', label: 'Account', href: '/account' },
};

/** Alerts left the nav in v2: it is the bell in the top bar. */
export const BELL_HREF = '/alerts';

/**
 * The five destinations, in the order v2 draws them (DX-03's sidebar). The same for everyone: the
 * viewer stays in the signature for the variations Account already has.
 */
export function tabsFor(_viewer: Viewer): readonly Tab[] {
  return [TAB.home, TAB.trades, TAB.messages, TAB.discover, TAB.account];
}

/** Where `/` sends someone who is signed in. */
export const ROOT_DESTINATION = '/home';

/**
 * Where the global search and Trade Code bar sends a query: a Trade Code goes to that code's own page,
 * which opens the trade for a party or the person it invited (and says "no trade found for you" to
 * anyone else); anything else is a search of the person's own trades; an empty query goes nowhere. A code is only put
 * in the path in its canonical `KMT-<digits>-NG` form, which `tradeCodeSchema` produces from what was
 * typed, so no input can name another route or host. Everything else is encoded as a query value.
 */
export function searchDestination(query: string): string | undefined {
  const text = query.trim();
  if (text === '') return undefined;
  const code = tradeCodeSchema.safeParse(text);
  if (code.success) return `/trades/${code.data}`;
  return `/search?q=${encodeURIComponent(text)}`;
}

const isSegmentPrefix = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * Which tab a path sits under, or `undefined` when it sits under none — a Park Hub application, the
 * alerts feed. Whole segments only: `/tradesmanship` is not the
 * Trades tab, and `aria-current="page"` on the wrong tab is worse than on none.
 */
export function currentTab(pathname: string, viewer: Viewer): TabId | undefined {
  return tabsFor(viewer).find((tab) => isSegmentPrefix(pathname, tab.href))?.id;
}

export type AccountItemId =
  | 'personal-info'
  | 'verification'
  | 'trust-history'
  | 'notifications'
  | 'security'
  | 'privacy'
  | 'addresses'
  | 'display'
  | 'refunds'
  | 'statements'
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
    { id: 'privacy', label: 'Privacy & data', href: '/account/privacy' },
    // F-044: where items are delivered, how the app looks, and the money and its paperwork.
    { id: 'addresses', label: 'Saved addresses', href: '/account/addresses' },
    { id: 'display', label: 'Display & accessibility', href: '/account/display' },
    { id: 'refunds', label: 'Where’s my refund?', href: '/account/refunds' },
    { id: 'statements', label: 'Statements', href: '/account/statements' },
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
