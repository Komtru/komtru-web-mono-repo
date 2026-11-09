// Trade realtime (T-068): who may be in a trade's room, and what is pushed into it.
//
// The room is `trade:<tradeCode>` over T-027's gateway. This file owns the one question the gateway
// cannot answer, "may this principal watch this trade?", and the shape of what a watcher is told.
//
// What a watcher is told is deliberately thin: that the trade changed, its new status and which event
// did it. No reason text, no actor, no amounts, no addresses. The room is a "refetch now" signal;
// what each party may SEE is decided by the HTTP read, which applies per-role disclosure and is
// re-authorised on every request. A push that carried the detail would make the socket a second,
// weaker read path — and the gateway does not re-authorise joined rooms when a role is revoked, so
// the thin payload is also what bounds that gap.
import type { EventDefinition, EventEnvelope } from '@komtru/shared-types';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../../../db/index.js';
import type { AfterCommit } from '../../../platform/events/bus.js';
import type { Logger } from '../../../platform/logger.js';
import type { RoomAuthorizer } from '../../socket/index.js';
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
} from '../domain/inspectionEvents.js';
import { tradeStateChangedEvent } from '../domain/events.js';
import type { TradeAction, TradeStatus } from '../domain/stateMachine.js';
import { trades } from './postgres/schema/trades.js';

export const TRADE_ROOM_PREFIX = 'trade';

/** The socket event every trade push uses. */
export const TRADE_UPDATED_EVENT = 'trade:updated';

/** The permission that lets staff watch any trade (M7 section 11). */
export const TRADE_VIEW_ALL = 'trade.view_all';

/**
 * Exactly the canonical stored form. `tradeCodeSchema` would accept `kmt-7398512` and normalise it, but
 * the gateway joins the id the client typed, while a push goes to the canonical room; accepting an
 * alias here would admit someone to a room nothing is ever sent to and invite a normalisation bug to
 * become an authorisation one. Anything else is refused before a query.
 */
const CANONICAL_TRADE_CODE = /^KMT-\d{5,8}-NG$/;

export interface TradeParties {
  buyerUserId: string | null;
  sellerUserId: string | null;
}

export interface TradeRoomDeps {
  /** `undefined` when no such trade exists. */
  parties: (tradeCode: string) => Promise<TradeParties | undefined>;
}

export const postgresTradeParties =
  (db: Pick<Db, 'select'>): TradeRoomDeps['parties'] =>
  async (tradeCode) => {
    const [row] = await db
      .select({ buyerUserId: trades.buyerUserId, sellerUserId: trades.sellerUserId })
      .from(trades)
      .where(eq(trades.tradeCode, tradeCode))
      .limit(1);
    return row;
  };

/**
 * Parties, and staff holding `trade.view_all`; nobody else. Default deny at every step: an unknown
 * trade and somebody else's trade give the same answer, so the room cannot be used to find out which
 * codes exist.
 *
 * - A party is the buyer or the seller of record, on a CONSUMER session. The initiator is always one
 *   of the two (a database check), and a counterparty who has not claimed the trade is not yet a party.
 * - Staff is the STAFF scope AND the permission, both read off the principal the gateway re-resolved
 *   from Postgres. The permission alone is not enough: a role is not a session scope.
 * - A user who is a party but signed in under the staff or logistics scope does not get the consumer
 *   view of their own trade through that session.
 */
export const tradeRoomAuthorizer =
  (deps: TradeRoomDeps): RoomAuthorizer =>
  async ({ principal, id }) => {
    if (!CANONICAL_TRADE_CODE.test(id)) return false;

    if (principal.scope !== 'STAFF' && principal.scope !== 'CONSUMER') return false;
    // Staff without the permission never reach the database either.
    if (principal.scope === 'STAFF' && !principal.permissions.has(TRADE_VIEW_ALL)) return false;

    const parties = await deps.parties(id);
    if (!parties) return false;
    if (principal.scope === 'STAFF') return true;
    return principal.userId === parties.buyerUserId || principal.userId === parties.sellerUserId;
  };

// ---------------------------------------------------------------------------
// What is pushed
// ---------------------------------------------------------------------------

/** What happened, in the UI's terms. `STATE_CHANGED` is the one every status change produces. */
export const TRADE_UPDATE_KINDS = [
  'STATE_CHANGED',
  'DELIVERY_EXTENSION_REQUESTED',
  'DELIVERY_EXTENSION_RESPONDED',
  'DELIVERY_OVERDUE',
  'REFUND_REQUESTED',
  'COMPLETED',
  'INSPECTION_EXTENSION_REQUESTED',
  'INSPECTION_EXTENSION_RESPONDED',
] as const;
export type TradeUpdateKind = (typeof TRADE_UPDATE_KINDS)[number];

/**
 * The `trade:updated` payload. Everything beyond `kind` is optional because only a state change has a
 * status; the rest are the few non-sensitive facts a tab needs to know WHICH part to refetch. There is
 * no `reason`, `actorId`, amount or address here, by design (see the header).
 */
export interface TradeUpdate {
  tradeId: string;
  tradeCode: string;
  kind: TradeUpdateKind;
  /** The trade's status after the change; present on `STATE_CHANGED` and `DELIVERY_OVERDUE`. */
  status?: TradeStatus;
  previousStatus?: TradeStatus;
  action?: TradeAction;
  /** The deadline now in force, ISO 8601, when the event moved or reported one. */
  dueAt?: string;
  decision?: 'ACCEPTED' | 'DECLINED';
  via?: 'BUYER_CONFIRMED' | 'INSPECTION_ELAPSED';
  /** When the event happened, so a client can discard an update older than its last refetch. */
  occurredAt: string;
}

export interface TradePush<S extends z.ZodType = z.ZodType> {
  /** The platform subscriber name; one subscriber per event type. */
  subscriber: string;
  event: EventDefinition<S>;
  update: (payload: z.output<S>, envelope: EventEnvelope<z.output<S>>) => Omit<TradeUpdate, 'occurredAt'>;
}

const definePush = <S extends z.ZodType>(push: TradePush<S>): TradePush => push as unknown as TradePush;

/**
 * Every event a workspace tab reacts to. State changes come from `applyTransition`, the only writer of
 * `trades.status`, so one subscriber on `trades.trade.state_changed` is "every state change pushes";
 * the rest are things that happen to a trade without changing its status (a request, a deadline).
 */
export const TRADE_PUSHES: TradePush[] = [
  definePush({
    subscriber: 'trades.push-state-changed',
    event: tradeStateChangedEvent,
    update: (p) => ({
      tradeId: p.tradeId,
      tradeCode: p.tradeCode,
      kind: 'STATE_CHANGED',
      status: p.to,
      previousStatus: p.from,
      action: p.action,
    }),
  }),
  definePush({
    subscriber: 'trades.push-delivery-extension-requested',
    event: tradeDeliveryExtensionRequestedEvent,
    update: (p) => ({
      tradeId: p.tradeId,
      tradeCode: p.tradeCode,
      kind: 'DELIVERY_EXTENSION_REQUESTED',
      dueAt: p.currentDueAt,
    }),
  }),
  definePush({
    subscriber: 'trades.push-delivery-extension-responded',
    event: tradeDeliveryExtensionRespondedEvent,
    update: (p) => ({
      tradeId: p.tradeId,
      tradeCode: p.tradeCode,
      kind: 'DELIVERY_EXTENSION_RESPONDED',
      decision: p.decision,
      ...(p.newDueAt ? { dueAt: p.newDueAt } : {}),
    }),
  }),
  definePush({
    subscriber: 'trades.push-delivery-overdue',
    event: tradeDeliveryOverdueEvent,
    update: (p) => ({
      tradeId: p.tradeId,
      tradeCode: p.tradeCode,
      kind: 'DELIVERY_OVERDUE',
      status: p.status,
      dueAt: p.dueAt,
    }),
  }),
  definePush({
    subscriber: 'trades.push-refund-requested',
    event: tradeRefundRequestedEvent,
    update: (p) => ({ tradeId: p.tradeId, tradeCode: p.tradeCode, kind: 'REFUND_REQUESTED' }),
  }),
  definePush({
    subscriber: 'trades.push-completed',
    event: tradeCompletedEvent,
    update: (p) => ({ tradeId: p.tradeId, tradeCode: p.tradeCode, kind: 'COMPLETED', via: p.via }),
  }),
  definePush({
    subscriber: 'trades.push-inspection-extension-requested',
    event: tradeInspectionExtensionRequestedEvent,
    update: (p) => ({
      tradeId: p.tradeId,
      tradeCode: p.tradeCode,
      kind: 'INSPECTION_EXTENSION_REQUESTED',
      dueAt: p.currentDueAt,
    }),
  }),
  definePush({
    subscriber: 'trades.push-inspection-extension-responded',
    event: tradeInspectionExtensionRespondedEvent,
    update: (p) => ({
      tradeId: p.tradeId,
      tradeCode: p.tradeCode,
      kind: 'INSPECTION_EXTENSION_RESPONDED',
      decision: p.decision,
      ...(p.newDueAt ? { dueAt: p.newDueAt } : {}),
    }),
  }),
];

/** The slice of the socket gateway a push needs, so a test needs no server. */
export interface TradeRoomGateway {
  emitToRoom: (prefix: string, id: string, event: string, payload: unknown) => void;
}

/**
 * Builds the subscription handler. The emit is RETURNED, not performed: the bus runs it once the
 * handler's transaction has committed, so a client that refetches on the push never reads the state
 * from before it. A redelivered event pushes twice, which is harmless: the push is "refetch", not a
 * delta. A failed emit is logged and dropped; the HTTP read is the source of truth and a client
 * refetches on reconnect.
 */
export const pushHandler =
  (gateway: TradeRoomGateway, logger: Logger, push: TradePush) =>
  (envelope: EventEnvelope<unknown>): Promise<AfterCommit> => {
    const update: TradeUpdate = {
      ...push.update(envelope.payload, envelope),
      occurredAt: envelope.occurredAt,
    };
    return Promise.resolve(() => {
      try {
        gateway.emitToRoom(TRADE_ROOM_PREFIX, update.tradeCode, TRADE_UPDATED_EVENT, update);
      } catch (error) {
        logger.error({ err: error, tradeId: update.tradeId, kind: update.kind }, 'trades: push failed');
      }
      return Promise.resolve();
    });
  };
