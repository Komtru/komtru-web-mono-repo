// What the trade workspace says about a trade, as pure functions: no DOM, so the wording and the rules about
// who may do what are tested without rendering. The backend decides what is true (status, role, deadlines); this
// decides how it is worded and which actions are on offer.
//
// ONE surface renders both sides. Nothing here returns a "buyer's screen" or a "seller's screen": a function
// takes the trade's own `yourRole` and returns the words for the person reading, so the two views cannot drift.
import type { TradeActivityItem, TradeActivityKind } from '@komtru/shared-types';

export type TradeRole = 'BUYER' | 'SELLER';
export type ChipTone = 'protected' | 'awaiting' | 'risk' | 'resolved' | 'verified' | 'verifying';

/** Every status from the agreement onward: the ones the workspace renders (anything earlier is a proposal). */
export const WORKSPACE_STATUSES = [
  'PENDING_PAYMENT',
  'FUNDED',
  'SHIPPED',
  'UNCONFIRMED_DELIVERY',
  'INSPECTION',
  'COMPLETED',
  'SETTLED',
  'DISPUTED',
  'RESOLVED_REFUNDED',
  'RESOLVED_RELEASED',
  'CANCELLED_REFUNDED',
] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const isWorkspaceStatus = (status: string): status is WorkspaceStatus =>
  (WORKSPACE_STATUSES as readonly string[]).includes(status);

export interface WorkspaceStanding {
  chip: { tone: ChipTone; label: string };
  /** 1 to 5 on the five-step bar (Agreement, Protected, Shipped, Inspection, Release); none for a refund. */
  stage: number | undefined;
  /** Nothing more will happen to this trade. */
  closed: boolean;
}

/** The chip and the place on the five-step bar, from the status alone (the reference's CWT-01 to CWT-06). */
export function workspaceStanding(status: WorkspaceStatus): WorkspaceStanding {
  switch (status) {
    case 'PENDING_PAYMENT':
      return { chip: { tone: 'awaiting', label: 'Awaiting funding' }, stage: 2, closed: false };
    case 'FUNDED':
      return { chip: { tone: 'protected', label: 'Funds protected' }, stage: 3, closed: false };
    case 'SHIPPED':
      return { chip: { tone: 'verifying', label: 'In transit' }, stage: 3, closed: false };
    case 'UNCONFIRMED_DELIVERY':
      return { chip: { tone: 'awaiting', label: 'Delivery to confirm' }, stage: 3, closed: false };
    case 'INSPECTION':
      return { chip: { tone: 'verifying', label: 'Inspection active' }, stage: 4, closed: false };
    case 'DISPUTED':
      return { chip: { tone: 'risk', label: 'Disputed' }, stage: 4, closed: false };
    case 'COMPLETED':
      return { chip: { tone: 'verifying', label: 'Settlement pending' }, stage: 5, closed: false };
    case 'SETTLED':
      return { chip: { tone: 'resolved', label: 'Complete' }, stage: 5, closed: true };
    case 'RESOLVED_RELEASED':
      return { chip: { tone: 'resolved', label: 'Released to seller' }, stage: 5, closed: true };
    case 'RESOLVED_REFUNDED':
    case 'CANCELLED_REFUNDED':
      return { chip: { tone: 'resolved', label: 'Refunded' }, stage: undefined, closed: true };
  }
}

// ---------------------------------------------------------------------------
// The tabs
// ---------------------------------------------------------------------------

export const WORKSPACE_TABS = ['overview', 'terms', 'activity', 'actions'] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

const TAB_LABEL: Record<WorkspaceTab, string> = {
  overview: 'Overview',
  terms: 'Terms',
  activity: 'Activity',
  actions: 'Actions',
};

/** The route of each tab; the overview is the trade's own address, the rest hang off it. */
export const tabHref = (tradeId: string, tab: WorkspaceTab): string =>
  tab === 'overview' ? `/trade/${tradeId}` : `/trade/${tradeId}/${tab}`;

export const tabItems = (tradeId: string) =>
  WORKSPACE_TABS.map((tab) => ({ id: tab, label: TAB_LABEL[tab], href: tabHref(tradeId, tab) }));

// ---------------------------------------------------------------------------
// Actions (CWT-09)
// ---------------------------------------------------------------------------

/**
 * `live`: the app does it, here. `later`: belongs to a feature that is not built, so it is told plainly and has
 * no button (never a control that does nothing). `guarded`: nobody does it by hand; it follows an outcome.
 */
export type ActionAvailability = 'live' | 'later' | 'guarded';

export interface TradeActionRow {
  id: string;
  title: string;
  description: string;
  availability: ActionAvailability;
  /** Where a live action that is only a link goes; a live action that changes the trade has none. */
  href?: string;
}

const PRE_FUNDING: readonly WorkspaceStatus[] = ['PENDING_PAYMENT'];

/**
 * What the person can do with this trade right now, derived from its status and from THEIR side of it. The
 * list is the reference's CWT-09 ("actions derive from state, role and policy"): the same rows for the same
 * facts, whichever of the two people is reading, in their own words.
 *
 * Only what is real is `live`: reading the agreed terms and activity, and withdrawing before payment (the
 * platform lets either party cancel an agreed trade nobody has paid for). Everything else names the feature
 * that will own it. SEAM(F-024 funding, F-026 shipping, F-027 inspection, F-030 cancellation after payment,
 * F-032 disputes): turn a `later` row into a `live` one when the flow exists, and nothing else here changes.
 */
export function tradeActions(status: WorkspaceStatus, role: TradeRole, tradeId: string): TradeActionRow[] {
  const rows: TradeActionRow[] = [
    {
      id: 'view-terms',
      title: 'View agreed terms · Safe',
      description: 'Always available; does not change the trade.',
      availability: 'live',
      href: tabHref(tradeId, 'terms'),
    },
  ];
  const buyer = role === 'BUYER';
  const later = (id: string, title: string, description: string): void => {
    rows.push({ id, title, description, availability: 'later' });
  };

  switch (status) {
    case 'PENDING_PAYMENT':
      if (buyer)
        later('fund', 'Fund trade · Buyer', "Paying isn't in the app yet. Nothing has been taken from you.");
      break;
    case 'FUNDED':
      if (!buyer) later('ship', 'Ship the item · Seller', "Marking the item shipped isn't in the app yet.");
      later(
        'cancel-after-payment',
        'Ask to cancel · Either party',
        "Cancelling a trade that is already paid for isn't in the app yet.",
      );
      break;
    case 'SHIPPED':
      if (!buyer)
        later('report-delivered', 'Report delivery · Seller', "Reporting delivery isn't in the app yet.");
      else
        later('confirm-delivery', 'Confirm you have it · Buyer', "Confirming delivery isn't in the app yet.");
      break;
    case 'UNCONFIRMED_DELIVERY':
      if (buyer)
        later('confirm-delivery', 'Confirm delivery · Buyer', "Confirming delivery isn't in the app yet.");
      break;
    case 'INSPECTION':
      if (buyer) {
        later(
          'accept',
          'Accept the item · Buyer',
          "Accepting and releasing the payment isn't in the app yet.",
        );
        later(
          'more-time',
          'Ask for more time · Buyer',
          "Asking for more inspection time isn't in the app yet.",
        );
        later('report-issue', 'Report an issue · Buyer', "Reporting an issue isn't in the app yet.");
      } else {
        later(
          'answer-extension',
          'Answer a request for more time · Seller',
          "Answering isn't in the app yet.",
        );
      }
      break;
    default:
      break;
  }

  if (PRE_FUNDING.includes(status)) {
    rows.push({
      id: 'cancel',
      title: 'Withdraw · Either party',
      description: 'Available until the trade is paid for. Nothing is charged when you do.',
      availability: 'live',
    });
  }
  if (status !== 'PENDING_PAYMENT' && status !== 'CANCELLED_REFUNDED') {
    rows.push({
      id: 'release',
      title: 'Release funds · Guarded',
      description: 'Not a shortcut anyone can take. It follows an authorised settlement outcome.',
      availability: 'guarded',
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// The activity feed's words (CWT-08)
// ---------------------------------------------------------------------------

const ACTIVITY_TITLE: Record<TradeActivityKind, string> = {
  PROPOSAL_SENT: 'Proposal sent',
  PROPOSAL_HELD: 'Proposal held for review',
  PROPOSAL_NOT_SENT: 'Proposal not sent',
  INVITATION_CLAIMED: 'Invitation accepted',
  TERMS_CHANGED: 'Terms changed',
  TERMS_AGREED: 'Terms agreed',
  PROPOSAL_DECLINED: 'Proposal declined',
  TRADE_CANCELLED: 'Trade cancelled',
  TRADE_EXPIRED: 'Trade expired',
  FUNDS_PROTECTED: 'Payment confirmed',
  SHIPPED: 'Seller dispatched',
  DELIVERY_REPORTED: 'Delivery reported',
  DELIVERY_CONFIRMED: 'Delivery confirmed',
  DELIVERY_ASSUMED: 'Delivery treated as confirmed',
  TRADE_COMPLETED: 'Item accepted',
  INSPECTION_ELAPSED: 'Inspection window ended',
  SETTLED: 'Settled',
  REFUNDED: 'Cancelled and refunded',
  DISPUTE_OPENED: 'Issue reported',
  DISPUTE_RESOLVED: 'Dispute resolved',
  DELIVERY_EXTENSION_REQUESTED: 'More time to deliver requested',
  DELIVERY_EXTENSION_ACCEPTED: 'More time to deliver agreed',
  DELIVERY_EXTENSION_DECLINED: 'More time to deliver declined',
  DELIVERY_EXTENSION_LAPSED: 'Request for more time to deliver lapsed',
  INSPECTION_EXTENSION_REQUESTED: 'More inspection time requested',
  INSPECTION_EXTENSION_ACCEPTED: 'More inspection time agreed',
  INSPECTION_EXTENSION_DECLINED: 'More inspection time declined',
  INSPECTION_EXTENSION_LAPSED: 'Request for more inspection time lapsed',
};

/** The one thing a row adds to its title: why it happened, where the platform records a state's cause. */
const ACTIVITY_NOTE: Partial<Record<TradeActivityKind, string>> = {
  FUNDS_PROTECTED: 'Funds are held by Komtru until the trade settles',
  TRADE_COMPLETED: 'The buyer accepted the item',
  INSPECTION_ELAPSED: 'No issue was reported, so the trade went on to settlement',
  DELIVERY_ASSUMED: 'The buyer did not answer in time',
};

/** "You", "The seller", "Komtru": who did it, from the reader's side. */
export function actorLabel(actor: TradeActivityItem['actor'], yourRole: TradeRole): string {
  if (actor === 'YOU') return 'You';
  if (actor === 'KOMTRU') return 'Komtru';
  return yourRole === 'BUYER' ? 'The seller' : 'The buyer';
}

export function describeActivity(
  item: TradeActivityItem,
  yourRole: TradeRole,
): { title: string; detail: string[] } {
  const detail = [actorLabel(item.actor, yourRole)];
  const note = ACTIVITY_NOTE[item.kind];
  if (note !== undefined) detail.push(note);
  if (item.reason !== null) detail.push(`Reason: ${item.reason}`);
  return { title: ACTIVITY_TITLE[item.kind], detail };
}
