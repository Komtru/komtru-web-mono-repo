// The trade realtime wire contract (T-068): what a trade room is told, declared once and imported by
// the backend that emits it and by every client that reads it.
//
// It lives here, not in the backend, because a client coded against a type that only exists in
// backend source can drift from it and nothing errors until a screen shows stale state. The backend's
// contract test parses what its push definitions actually produce with `tradeUpdateSchema`, and the
// schema is strict, so a field added to a push without being added here fails that test.
//
// The payload is a "refetch now" signal, not a read model. It deliberately carries no reason, actor,
// amount or address: what each party may SEE is decided by the HTTP read, re-authorised on every
// request.
import { z } from 'zod';

/** Design section 6.1, in lifecycle order. The order is what "forwards" means. */
export const TRADE_STATUSES = [
  'DRAFT',
  'PENDING_COUNTERPARTY',
  'UNDER_PROPOSAL_REVIEW',
  'AWAITING_ACCEPTANCE',
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
  'DECLINED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
] as const;
export const tradeStatusSchema = z.enum(TRADE_STATUSES);
export type TradeStatus = z.infer<typeof tradeStatusSchema>;

export const TRADE_ACTIONS = [
  'SEND',
  'CLAIM_INVITATION',
  'EXPIRE',
  'CLEAR_REVIEW',
  'REJECT_REVIEW',
  'COUNTER_PROPOSE',
  'ACCEPT',
  'DECLINE',
  'CANCEL',
  'FUND',
  'BEGIN_CUSTODY',
  'REFUND_CANCELLATION',
  'DELIVERY_SIGNAL',
  'CONFIRM_RECEIPT',
  'GRACE_ELAPSED',
  'COMPLETE',
  'INSPECTION_ELAPSED',
  'SETTLE',
  'DISPUTE',
  'RESOLVE_DISPUTE',
] as const;
export const tradeActionSchema = z.enum(TRADE_ACTIONS);
export type TradeAction = z.infer<typeof tradeActionSchema>;

/** A socket room is `<prefix>:<id>`; a trade's id is its canonical trade code. */
export const TRADE_ROOM_PREFIX = 'trade';

/** The one socket event every trade push uses. */
export const TRADE_UPDATED_EVENT = 'trade:updated';

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
  'INSPECTION_REMINDER',
] as const;
export const tradeUpdateKindSchema = z.enum(TRADE_UPDATE_KINDS);
export type TradeUpdateKind = z.infer<typeof tradeUpdateKindSchema>;

/** Exactly the stored form (`tradeCodeSchema` would normalise an alias, which a room id must not). */
export const canonicalTradeCodeSchema = z.string().regex(/^KMT-\d{5,8}-NG$/);

export const tradeUpdateSchema = z
  .strictObject({
    tradeId: z.uuid(),
    tradeCode: canonicalTradeCodeSchema,
    kind: tradeUpdateKindSchema,
    /** The trade's status after the change; present on `STATE_CHANGED` and `DELIVERY_OVERDUE`. */
    status: tradeStatusSchema.optional(),
    previousStatus: tradeStatusSchema.optional(),
    action: tradeActionSchema.optional(),
    /** The deadline now in force (or reported), ISO 8601, when the event moved or reported one. */
    dueAt: z.iso.datetime().optional(),
    decision: z.enum(['ACCEPTED', 'DECLINED']).optional(),
    via: z.enum(['BUYER_CONFIRMED', 'INSPECTION_ELAPSED']).optional(),
    /** When it happened. Discard a push older than your last refetch. */
    occurredAt: z.iso.datetime(),
  })
  .check((ctx) => {
    const v = ctx.value;
    const need = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.issues.push({ code: 'custom', input: v, message, path: [path] });
    };
    if (v.kind === 'STATE_CHANGED') {
      need(v.status !== undefined, 'status', 'STATE_CHANGED carries the new status');
      need(v.previousStatus !== undefined, 'previousStatus', 'STATE_CHANGED carries the previous status');
      need(v.action !== undefined, 'action', 'STATE_CHANGED carries the action');
    }
    if (v.kind === 'DELIVERY_OVERDUE')
      need(v.status !== undefined, 'status', 'DELIVERY_OVERDUE carries status');
    if (v.kind === 'COMPLETED') need(v.via !== undefined, 'via', 'COMPLETED carries how');
    if (v.kind.endsWith('_RESPONDED'))
      need(v.decision !== undefined, 'decision', 'a response carries its decision');
  });
export type TradeUpdate = z.infer<typeof tradeUpdateSchema>;
