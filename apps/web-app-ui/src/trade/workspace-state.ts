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
      return { chip: { tone: 'resolved', label: 'Refunded' }, stage: undefined, closed: true };
    case 'CANCELLED_REFUNDED':
      // The status means the ledger decided a refund, not that the money has gone back: a refund can still be on its
      // way, or held after the provider failed it. The overview says which, from the trade's own refund row.
      return { chip: { tone: 'resolved', label: 'Cancelled · refund' }, stage: undefined, closed: true };
  }
}

// ---------------------------------------------------------------------------
// The tabs
// ---------------------------------------------------------------------------

/**
 * The tabs of a trade, as data. THE EXTENSION SEAM: a later feature that adds a tab (a payment view, a case)
 * adds one entry here and one component to the registry in `workspace/tabs.tsx`, which is typed to need every
 * id in this list, so a tab with a title and no content (or the reverse) does not compile. The route
 * `/trade/[id]/[tab]`, the tab strip and the header title all read this list.
 */
export const WORKSPACE_TAB_DEFS = [
  { id: 'overview', label: 'Overview', title: 'Trade' },
  { id: 'terms', label: 'Terms', title: 'Agreed Terms' },
  { id: 'activity', label: 'Activity', title: 'Trade Activity' },
  { id: 'actions', label: 'Actions', title: 'Trade Actions' },
] as const;

export type WorkspaceTab = (typeof WORKSPACE_TAB_DEFS)[number]['id'];
export const WORKSPACE_TABS: readonly WorkspaceTab[] = WORKSPACE_TAB_DEFS.map((tab) => tab.id);

export const isWorkspaceTab = (value: string): value is WorkspaceTab =>
  (WORKSPACE_TABS as readonly string[]).includes(value);

export const tabTitle = (tab: WorkspaceTab): string =>
  WORKSPACE_TAB_DEFS.find((def) => def.id === tab)?.title ?? 'Trade';

/** The route of each tab; the overview is the trade's own address, the rest hang off it. */
export const tabHref = (tradeId: string, tab: WorkspaceTab): string =>
  tab === 'overview' ? `/trade/${tradeId}` : `/trade/${tradeId}/${tab}`;

/** Where the buyer pays into escrow (F-024). Its own route, not a tab: it is a flow, not a view of the trade. */
export const fundHref = (tradeId: string): string => `/trade/${tradeId}/fund`;

/** Where the seller ships a funded trade (F-026). Its own route: a flow, not a view of the trade. */
export const shipHref = (tradeId: string): string => `/trade/${tradeId}/dispatch`;
// F-028 (CWT-S08 to CWT-S13): the delivery and evidence sheets behind the workspace, each its own route.
export const dispatchHref = (tradeId: string): string => `/trade/${tradeId}/dispatch`;
export const waybillHref = (tradeId: string): string => `/trade/${tradeId}/dispatch/waybill`;
export const trackHref = (tradeId: string): string => `/trade/${tradeId}/track`;
export const pickupHref = (tradeId: string): string => `/trade/${tradeId}/pickup`;
export const evidenceHref = (tradeId: string): string => `/trade/${tradeId}/evidence`;
/**
 * Where there is evidence to browse (CWT-S12): from shipment on, including the two outcomes that follow a dispute
 * (the platform's own `EVIDENCE_VISIBLE`). The Evidence screen and the Actions row read this one list.
 */
export const EVIDENCE_STATUSES: readonly WorkspaceStatus[] = [
  'SHIPPED',
  'UNCONFIRMED_DELIVERY',
  'INSPECTION',
  'DISPUTED',
  'COMPLETED',
  'SETTLED',
  'RESOLVED_RELEASED',
  'RESOLVED_REFUNDED',
];
export const addEvidenceHref = (tradeId: string): string => `/trade/${tradeId}/evidence/new`;
/** Inspect & Confirm (Z4/Z5), and for the seller the answer to a request for more time (BEI2). */
export const reportIssueHref = (tradeId: string): string => `/trade/${tradeId}/dispute`;

/** F-032: where the DISPUTED body sends both parties. */
export const disputeStatusHref = (tradeId: string): string => `/trade/${tradeId}/dispute/status`;

export const inspectHref = (tradeId: string): string => `/trade/${tradeId}/inspect`;
/** DE1: the seller asks the buyer for more time to deliver. */
export const extendHref = (tradeId: string): string => `/trade/${tradeId}/extend`;

/** F-030: CT1 before payment, CR1 (the buyer) or SC1 (the seller) after it: the trade decides which the page is. */
export const cancelHref = (tradeId: string): string => `/trade/${tradeId}/cancel`;
/** F-030 (CR2): the seller answers the buyer's cancellation request. */
export const cancelRequestHref = (tradeId: string): string => `/trade/${tradeId}/cancel-request`;

export const tabItems = (tradeId: string) =>
  WORKSPACE_TAB_DEFS.map((tab) => ({ id: tab.id, label: tab.label, href: tabHref(tradeId, tab.id) }));

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
/** While the money sits with Komtru. Once it has been released or returned there is nothing left to guard. */
const FUNDS_HELD: readonly WorkspaceStatus[] = [
  'FUNDED',
  'SHIPPED',
  'UNCONFIRMED_DELIVERY',
  'INSPECTION',
  'DISPUTED',
  'COMPLETED',
];

const moreTimeRow = (tradeId: string): TradeActionRow => ({
  id: 'ask-more-time',
  title: 'Ask for more time · Seller',
  description: 'Ask the buyer for a later delivery date before the deadline passes, once.',
  availability: 'live',
  href: extendHref(tradeId),
});

const confirmDeliveryRow = (tradeId: string, title: string): TradeActionRow => ({
  id: 'confirm-delivery',
  title,
  description: 'Say the item has arrived. Your inspection time starts.',
  availability: 'live',
  href: tabHref(tradeId, 'overview'),
});

/**
 * What the person can do with this trade right now, derived from its status and from THEIR side of it. The
 * list is the reference's CWT-09 ("actions derive from state, role and policy"): the same rows for the same
 * facts, whichever of the two people is reading, in their own words.
 *
 * Only what is real is `live`: reading the agreed terms and activity, withdrawing before payment (the
 * platform lets either party cancel an agreed trade nobody has paid for), the buyer's funding (F-024) and
 * cancelling after payment (F-030), and reporting an issue (F-032). Everything else names the feature that
 * will own it: add a row with `availability: 'later'` and a sentence saying so, and turn it `live` when the
 * flow exists.
 */
export function tradeActions(
  status: WorkspaceStatus,
  role: TradeRole,
  tradeId: string,
  /**
   * What the platform's cancellation read allows this reader (F-030). The row for cancelling a funded trade is offered
   * only when it says so: a trade with a request already waiting, a hold or a refund on its way offers none, and one
   * whose read has not come back offers none either.
   */
  cancellation?: { canRequest: boolean; canCancelAsSeller: boolean },
): TradeActionRow[] {
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

  switch (status) {
    case 'PENDING_PAYMENT':
      if (buyer)
        rows.push({
          id: 'fund',
          title: 'Fund trade · Buyer',
          description: 'Pay into escrow. Komtru holds the money until you confirm delivery.',
          availability: 'live',
          href: fundHref(tradeId),
        });
      break;
    case 'FUNDED':
      if (!buyer) {
        rows.push({
          id: 'ship',
          title: 'Ship the item · Seller',
          description: 'Say how it is going and give the waybill, receipt photo, driver phone and plate.',
          availability: 'live',
          href: shipHref(tradeId),
        });
        rows.push(moreTimeRow(tradeId));
      }
      if (buyer && cancellation?.canRequest === true) {
        rows.push({
          id: 'ask-cancel',
          title: 'Ask to cancel · Buyer',
          description:
            'Ask the seller to cancel before the item ships. If they agree, a refund is requested for you.',
          availability: 'live',
          href: cancelHref(tradeId),
        });
      }
      if (!buyer && cancellation?.canCancelAsSeller === true) {
        rows.push({
          id: 'cannot-fulfil',
          title: 'Can’t fulfil · Seller',
          description: 'Cancel the trade because you can’t deliver. A refund is requested for the buyer.',
          availability: 'live',
          href: cancelHref(tradeId),
        });
      }
      break;
    case 'SHIPPED':
      if (!buyer) {
        rows.push({
          id: 'report-delivered',
          title: 'Report delivery · Seller',
          description: 'Say the item has arrived, so the buyer is asked to confirm.',
          availability: 'live',
          href: dispatchHref(tradeId),
        });
        rows.push(moreTimeRow(tradeId));
      } else rows.push(confirmDeliveryRow(tradeId, 'Confirm you have it · Buyer'));
      break;
    case 'UNCONFIRMED_DELIVERY':
      if (buyer) rows.push(confirmDeliveryRow(tradeId, 'Confirm delivery · Buyer'));
      break;
    case 'INSPECTION':
      if (buyer) {
        rows.push(
          {
            id: 'accept',
            title: 'Accept the item · Buyer',
            description: 'Compare it with the seller’s proof, then confirm and release the payment.',
            availability: 'live',
            href: inspectHref(tradeId),
          },
          {
            id: 'more-time',
            title: 'Ask for more time · Buyer',
            description: 'Ask the seller to extend the inspection window, once.',
            availability: 'live',
            href: inspectHref(tradeId),
          },
        );
        rows.push({
          id: 'report-issue',
          title: 'Report an issue · Buyer',
          description: 'Open a case. The payment stays held until it is resolved.',
          availability: 'live',
          href: reportIssueHref(tradeId),
        });
      } else {
        rows.push({
          id: 'answer-extension',
          title: 'Answer a request for more time · Seller',
          description: 'See whether the buyer asked for more inspection time, and agree or decline.',
          availability: 'live',
          href: inspectHref(tradeId),
        });
      }
      break;
    default:
      break;
  }

  // F-028: follow the parcel and browse what is on record, from the moment it has shipped.
  if (['SHIPPED', 'UNCONFIRMED_DELIVERY', 'INSPECTION'].includes(status)) {
    rows.push({
      id: 'track',
      title: 'Track delivery · Safe',
      description: 'See who has the item and what is recorded of its journey.',
      availability: 'live',
      href: trackHref(tradeId),
    });
  }
  if (EVIDENCE_STATUSES.includes(status)) {
    rows.push({
      id: 'evidence',
      title: 'Trade evidence · Safe',
      description: 'Browse the photos and receipts kept with this trade, by event.',
      availability: 'live',
      href: evidenceHref(tradeId),
    });
  }

  if (PRE_FUNDING.includes(status)) {
    rows.push({
      id: 'cancel',
      title: 'Withdraw · Either party',
      description: 'Available until the trade is paid for. Komtru checks for a payment on its way first.',
      availability: 'live',
      href: cancelHref(tradeId),
    });
  }
  if (FUNDS_HELD.includes(status)) {
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

/**
 * The one thing a row adds to its title: why it happened. Each note is true only of a particular kind of actor,
 * so it is attached only to that kind: "the buyer accepted the item" is not said of a step Komtru took.
 */
const ACTIVITY_NOTE: Partial<Record<TradeActivityKind, { note: string; by: 'PARTY' | 'KOMTRU' }>> = {
  FUNDS_PROTECTED: { note: 'Funds are held by Komtru until the trade settles', by: 'KOMTRU' },
  TRADE_COMPLETED: { note: 'The buyer accepted the item', by: 'PARTY' },
  INSPECTION_ELAPSED: { note: 'No issue was reported, so the trade went on to settlement', by: 'KOMTRU' },
  DELIVERY_ASSUMED: { note: 'The buyer did not answer in time', by: 'KOMTRU' },
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
  if (note !== undefined && (note.by === 'KOMTRU') === (item.actor === 'KOMTRU')) detail.push(note.note);
  if (item.reason !== null) detail.push(`Reason: ${item.reason}`);
  return { title: ACTIVITY_TITLE[item.kind], detail };
}
