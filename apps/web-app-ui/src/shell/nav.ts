// The app's navigation, as data.
//
// One account, one set of destinations (design C22, §6.3): no buyer view, no seller view, no role
// switcher, no second tab bar. Two things vary, and both are facts about the person rather than a
// mode they chose:
//
//   * a certified merchant is sell-only, so **Shop takes Explore's place** — it is the same slot,
//     not a sixth tab, because a merchant has nothing to browse for;
//   * Account carries **Payouts** once someone has sold, and a **Park Agent** item whose
//     destination is the hub application, the application's status, or `park.komtru.com`.
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

export type TabId = 'trades' | 'explore' | 'shop' | 'alerts' | 'messages' | 'account';

export interface Tab {
  id: TabId;
  label: string;
  href: string;
}

const TAB: Record<TabId, Tab> = {
  trades: { id: 'trades', label: 'Trades', href: '/trades' },
  explore: { id: 'explore', label: 'Explore', href: '/explore' },
  shop: { id: 'shop', label: 'Shop', href: '/shop' },
  alerts: { id: 'alerts', label: 'Alerts', href: '/alerts' },
  messages: { id: 'messages', label: 'Messages', href: '/messages' },
  account: { id: 'account', label: 'Account', href: '/account' },
};

/** The five destinations, in the reference's own order, with the second slot decided by the person. */
export function tabsFor(viewer: Viewer): readonly Tab[] {
  const second = viewer.certifiedMerchant ? TAB.shop : TAB.explore;
  return [TAB.trades, second, TAB.alerts, TAB.messages, TAB.account];
}

const isSegmentPrefix = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * Which tab a path sits under, or `undefined` when it sits under none — a Park Hub application, a
 * sign-in. Whole segments only: `/tradesmanship` is not the Trades tab, and `aria-current="page"`
 * on the wrong tab is worse than on none.
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
