// What each trade event tells the people on the trade (T-068).
//
// A trade event names a TRADE, not its people: `trades.trade.state_changed` carries ids and a status.
// So "who is told, and with what values" needs a read of the trade's parties, which is why these are
// plans (event, template key, audience rule) rather than notify's payload-only bindings. notify's
// `binding.ts` wraps each plan with `defineBinding`; the copy is in notify's catalogue, keyed by the
// same template key. This file imports nothing from notify, which imports it.
//
// One event can feed several plans (a state change is a proposal, a funding, a delivery...), each with
// an `applies` filter, and a plan that does not apply returns no one without touching the database.
//
// Copy never carries a price, an address, a PIN, a staff-written reason or the other party's
// identity: a notification outlives the screen's disclosure rules, sits on a lock screen and in an
// inbox, and the deep link is the way to the detail the HTTP read will gate. What it does carry is the
// trade code and the link.
import type { EventDefinition } from '@komtru/shared-types';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Tx } from '../../../platform/events/publish.js';
import { tradeStateChangedEvent } from '../domain/events.js';
import {
  tradeDeliveryExtensionRequestedEvent,
  tradeDeliveryExtensionRespondedEvent,
  tradeDeliveryOverdueEvent,
  tradeRefundRequestedEvent,
} from '../domain/fulfilmentEvents.js';
import {
  tradeCompletedEvent,
  tradeInspectionExtensionRequestedEvent,
  tradeInspectionExtensionRespondedEvent,
  tradeInspectionReminderDueEvent,
} from '../domain/inspectionEvents.js';
import { trades } from './postgres/schema/trades.js';

/** Where a trade opens in the app. The origin is the app's, not the API's (`api.komtru.com`). */
export const APP_ORIGIN = 'https://app.komtru.com';
export const tradeDeepLink = (tradeCode: string): string => `${APP_ORIGIN}/trades/${tradeCode}`;

export type TradeRole = 'BUYER' | 'SELLER';

export type Audience =
  | 'BUYER'
  | 'SELLER'
  | 'BOTH'
  | 'INITIATOR'
  | 'NON_INITIATOR'
  /** Whoever did not cause the event; both parties when the event had no human actor. */
  | 'OTHER_THAN_ACTOR';

export interface TradeAudienceParties {
  buyerUserId: string | null;
  sellerUserId: string | null;
  initiatorUserId: string;
}

export interface TradeRecipient {
  userId: string;
  variables: Record<string, string>;
}

export interface TradeNotificationPlan<S extends z.ZodType = z.ZodType> {
  /** `notify.on-...`: the platform subscriber, one per (event, template). */
  subscriber: string;
  event: EventDefinition<S>;
  templateKey: string;
  applies: (payload: z.output<S>) => boolean;
  audience: Audience | ((payload: z.output<S>) => Audience);
  /** Template variables beyond `tradeCode` and `link`, per recipient. */
  extra?: (payload: z.output<S>, role: TradeRole) => Record<string, string>;
}

const plan = <S extends z.ZodType>(p: TradeNotificationPlan<S>): TradeNotificationPlan =>
  p as unknown as TradeNotificationPlan;

type Changed = z.output<typeof tradeStateChangedEvent.payload>;

/** A state change where `action` took the trade to `to` (any of the listed actions, if several). */
const changedTo =
  (to: Changed['to'], ...actions: Changed['action'][]) =>
  (p: Changed): boolean =>
    p.to === to && (actions.length === 0 || actions.includes(p.action));

const lagos = (iso: string): string =>
  new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(new Date(iso));

const byRole =
  (buyer: string, seller: string) =>
  (_payload: unknown, role: TradeRole): Record<string, string> => ({
    nextStep: role === 'BUYER' ? buyer : seller,
  });

const decisionLine = (decision: 'ACCEPTED' | 'DECLINED', accepted: string, declined: string): string =>
  decision === 'ACCEPTED' ? accepted : declined;

const REFUND_REASON_LINE: Record<'DELIVERY_OVERDUE' | 'SELLER_CANNOT_FULFIL' | 'MUTUAL_AGREEMENT', string> = {
  DELIVERY_OVERDUE: 'Delivery was overdue.',
  SELLER_CANNOT_FULFIL: 'The seller cannot fulfil the trade.',
  MUTUAL_AGREEMENT: 'Both sides agreed to cancel.',
};

export const TRADE_NOTIFICATION_PLANS: TradeNotificationPlan[] = [
  // --- proposal -----------------------------------------------------------------------------
  plan({
    subscriber: 'notify.on-trade-proposal-received',
    event: tradeStateChangedEvent,
    templateKey: 'trades.proposal.received',
    // SEND to a known counterparty, or staff clearing a held proposal (R1). A proposal held for review
    // or waiting for an invitation to be claimed has no counterparty to tell yet.
    applies: (p) => changedTo('AWAITING_ACCEPTANCE', 'SEND', 'CLEAR_REVIEW')(p),
    audience: 'NON_INITIATOR',
  }),
  plan({
    subscriber: 'notify.on-trade-proposal-countered',
    event: tradeStateChangedEvent,
    templateKey: 'trades.proposal.countered',
    applies: (p) => p.action === 'COUNTER_PROPOSE',
    audience: 'OTHER_THAN_ACTOR',
  }),
  plan({
    subscriber: 'notify.on-trade-proposal-accepted',
    event: tradeStateChangedEvent,
    templateKey: 'trades.proposal.accepted',
    applies: changedTo('PENDING_PAYMENT', 'ACCEPT'),
    audience: 'OTHER_THAN_ACTOR',
    extra: byRole(
      'Pay into escrow to start the trade.',
      'The buyer has been asked to pay into escrow. Do not ship yet.',
    ),
  }),
  plan({
    subscriber: 'notify.on-trade-proposal-declined',
    event: tradeStateChangedEvent,
    templateKey: 'trades.proposal.declined',
    applies: changedTo('DECLINED', 'DECLINE'),
    audience: 'OTHER_THAN_ACTOR',
  }),
  plan({
    subscriber: 'notify.on-trade-proposal-rejected',
    event: tradeStateChangedEvent,
    templateKey: 'trades.proposal.rejected',
    applies: changedTo('REJECTED', 'REJECT_REVIEW'),
    audience: 'INITIATOR',
  }),

  // --- funding, shipping, delivery ------------------------------------------------------------
  plan({
    subscriber: 'notify.on-trade-funded',
    event: tradeStateChangedEvent,
    templateKey: 'trades.funded',
    applies: changedTo('FUNDED', 'FUND'),
    audience: 'BOTH',
    extra: byRole(
      'Your payment is held in escrow until you confirm delivery.',
      'The buyer has paid into escrow. You can ship now.',
    ),
  }),
  plan({
    subscriber: 'notify.on-trade-shipped',
    event: tradeStateChangedEvent,
    templateKey: 'trades.shipped',
    applies: changedTo('SHIPPED', 'BEGIN_CUSTODY'),
    audience: 'BUYER',
  }),
  plan({
    subscriber: 'notify.on-trade-delivered',
    event: tradeStateChangedEvent,
    templateKey: 'trades.delivered',
    // Delivery is confirmed by a trusted signal, by the buyer, or by the grace period elapsing; each
    // starts the inspection window, which is what the parties care about.
    applies: changedTo('INSPECTION', 'DELIVERY_SIGNAL', 'CONFIRM_RECEIPT', 'GRACE_ELAPSED'),
    audience: 'BOTH',
    extra: byRole(
      'Inspect it and confirm, or raise an issue, before the inspection window closes.',
      'The buyer is inspecting it now.',
    ),
  }),
  plan({
    subscriber: 'notify.on-trade-delivery-unconfirmed',
    event: tradeStateChangedEvent,
    templateKey: 'trades.delivery.unconfirmed',
    applies: changedTo('UNCONFIRMED_DELIVERY', 'DELIVERY_SIGNAL'),
    audience: 'BUYER',
  }),
  plan({
    subscriber: 'notify.on-trade-delivery-extension-requested',
    event: tradeDeliveryExtensionRequestedEvent,
    templateKey: 'trades.delivery_extension.requested',
    applies: () => true,
    audience: 'BUYER',
  }),
  plan({
    subscriber: 'notify.on-trade-delivery-extension-responded',
    event: tradeDeliveryExtensionRespondedEvent,
    templateKey: 'trades.delivery_extension.responded',
    applies: () => true,
    audience: 'SELLER',
    extra: (p) => ({
      outcomeLine: decisionLine(
        p.decision,
        'The buyer agreed to give you more time.',
        'The buyer declined your request for more time.',
      ),
    }),
  }),
  plan({
    subscriber: 'notify.on-trade-delivery-overdue',
    event: tradeDeliveryOverdueEvent,
    templateKey: 'trades.delivery.overdue',
    applies: () => true,
    audience: 'BOTH',
    extra: (p, role) => ({
      nextStep:
        role === 'BUYER'
          ? p.refundRequested
            ? 'A full refund has been requested for you.'
            : 'The seller has been asked for an update.'
          : p.refundRequested
            ? 'The buyer will be refunded.'
            : 'Please ship or ask for more time.',
    }),
  }),

  // --- inspection and completion --------------------------------------------------------------
  plan({
    subscriber: 'notify.on-trade-inspection-extension-requested',
    event: tradeInspectionExtensionRequestedEvent,
    templateKey: 'trades.inspection_extension.requested',
    applies: () => true,
    audience: 'SELLER',
  }),
  plan({
    subscriber: 'notify.on-trade-inspection-extension-responded',
    event: tradeInspectionExtensionRespondedEvent,
    templateKey: 'trades.inspection_extension.responded',
    applies: () => true,
    audience: 'BUYER',
    extra: (p) => ({
      outcomeLine: decisionLine(
        p.decision,
        'The seller agreed to give you more time to inspect.',
        'The seller declined your request for more time to inspect.',
      ),
    }),
  }),
  plan({
    subscriber: 'notify.on-trade-inspection-reminder',
    event: tradeInspectionReminderDueEvent,
    templateKey: 'trades.inspection.reminder',
    applies: () => true,
    audience: 'BUYER',
    extra: (p) => ({ dueAt: lagos(p.dueAt) }),
  }),
  plan({
    subscriber: 'notify.on-trade-completed-confirmed',
    event: tradeCompletedEvent,
    templateKey: 'trades.completed.confirmed',
    applies: (p) => p.via === 'BUYER_CONFIRMED',
    audience: 'SELLER',
  }),
  plan({
    subscriber: 'notify.on-trade-completed-auto-released',
    event: tradeCompletedEvent,
    templateKey: 'trades.completed.auto_released',
    applies: (p) => p.via === 'INSPECTION_ELAPSED',
    audience: 'BOTH',
    extra: byRole(
      'The inspection window ended with no issue raised, so payment is being released to the seller.',
      'The inspection window ended with no issue raised, so your payment is being released.',
    ),
  }),
  plan({
    subscriber: 'notify.on-trade-settled',
    event: tradeStateChangedEvent,
    templateKey: 'trades.settled',
    applies: changedTo('SETTLED', 'SETTLE'),
    audience: 'SELLER',
  }),

  // --- cancellation, expiry and refunds -------------------------------------------------------
  plan({
    subscriber: 'notify.on-trade-cancelled',
    event: tradeStateChangedEvent,
    templateKey: 'trades.cancelled',
    applies: changedTo('CANCELLED', 'CANCEL'),
    audience: 'OTHER_THAN_ACTOR',
  }),
  plan({
    subscriber: 'notify.on-trade-expired',
    event: tradeStateChangedEvent,
    templateKey: 'trades.expired',
    applies: changedTo('EXPIRED', 'EXPIRE'),
    audience: 'BOTH',
  }),
  plan({
    subscriber: 'notify.on-trade-refund-requested',
    event: tradeRefundRequestedEvent,
    templateKey: 'trades.refund.requested',
    applies: () => true,
    audience: 'BOTH',
    extra: (p, role) => ({
      reasonLine: REFUND_REASON_LINE[p.reason],
      nextStep:
        role === 'BUYER'
          ? 'We have asked for your money back and will tell you when it is returned.'
          : 'A refund to the buyer has been requested.',
    }),
  }),
  plan({
    subscriber: 'notify.on-trade-refunded',
    event: tradeStateChangedEvent,
    templateKey: 'trades.refund.cancelled_refunded',
    applies: changedTo('CANCELLED_REFUNDED', 'REFUND_CANCELLATION'),
    audience: 'BOTH',
    extra: byRole(
      'The trade is closed and your money is being returned.',
      'The trade is closed and the buyer is being refunded.',
    ),
  }),
];

/**
 * SEAM(T-093). Park hub arrival and the pickup PIN are surfaced by the workspace but have no event:
 * the Park module is not built, and inventing an event here would put its contract in the wrong
 * ticket. No template, mapping or binding is shipped for them either, deliberately. The PIN is a
 * credential, so how it is worded, which channel carries it and whether it may sit in an in-app feed
 * are T-093's security decisions. T-093 adds the event, the copy and a plan together; a test pins
 * that no plan uses these keys yet, so doing one without the others fails.
 */
export const T093_SEAMS = [
  {
    templateKey: 'trades.hub.arrived',
    note: 'Park hub arrival: the buyer is told the parcel is at the hub.',
  },
  {
    templateKey: 'trades.pickup_pin.ready',
    note: 'The pickup PIN is ready: a credential, T-093 decides delivery.',
  },
] as const;

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

const who = (audience: Audience, parties: TradeAudienceParties, actorId: string | undefined): TradeRole[] => {
  switch (audience) {
    case 'BUYER':
      return ['BUYER'];
    case 'SELLER':
      return ['SELLER'];
    case 'BOTH':
      return ['BUYER', 'SELLER'];
    case 'INITIATOR':
      return [parties.initiatorUserId === parties.buyerUserId ? 'BUYER' : 'SELLER'];
    case 'NON_INITIATOR':
      return [parties.initiatorUserId === parties.buyerUserId ? 'SELLER' : 'BUYER'];
    case 'OTHER_THAN_ACTOR':
      if (actorId === parties.buyerUserId) return ['SELLER'];
      if (actorId === parties.sellerUserId) return ['BUYER'];
      return ['BUYER', 'SELLER'];
  }
};

const actorOf = (payload: unknown): string | undefined => {
  const actorId = (payload as { actorId?: unknown }).actorId;
  return typeof actorId === 'string' ? actorId : undefined;
};

/**
 * Pure: who a plan tells, given the trade's parties. A party who is not on the trade yet (a buyer who
 * has not claimed an invitation) is skipped, never guessed.
 */
export function audienceFor(
  p: TradeNotificationPlan,
  payload: unknown,
  parties: TradeAudienceParties,
): TradeRecipient[] {
  const { tradeCode } = payload as { tradeCode: string };
  const audience = typeof p.audience === 'function' ? p.audience(payload) : p.audience;
  const recipients: TradeRecipient[] = [];
  for (const role of who(audience, parties, actorOf(payload))) {
    const userId = role === 'BUYER' ? parties.buyerUserId : parties.sellerUserId;
    if (!userId) continue;
    recipients.push({
      userId,
      variables: { tradeCode, link: tradeDeepLink(tradeCode), ...p.extra?.(payload, role) },
    });
  }
  return recipients;
}

/** The binding's audience resolver: nothing is read unless the plan applies. */
export async function resolveTradeAudience(
  tx: Tx,
  p: TradeNotificationPlan,
  payload: unknown,
): Promise<TradeRecipient[]> {
  if (!p.applies(payload)) return [];
  const { tradeId } = payload as { tradeId: string };
  const [row] = await tx
    .select({
      buyerUserId: trades.buyerUserId,
      sellerUserId: trades.sellerUserId,
      initiatorUserId: trades.initiatorUserId,
    })
    .from(trades)
    .where(eq(trades.id, tradeId));
  // A trade that is gone has no one to tell. Not an error: a retry cannot bring it back.
  return row ? audienceFor(p, payload, row) : [];
}
