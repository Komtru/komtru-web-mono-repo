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
import { paginatedSchema } from './pagination.js';

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

/**
 * Every status a trade can be in once its escrow is funded: FUNDED and everything reachable from it. A
 * trade here has been paid for. The backend derives the same set from its state machine and a test
 * pins the two together, so a status added to the machine cannot be missed here.
 */
export const FUNDED_TRADE_STATUSES = [
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
] as const satisfies readonly TradeStatus[];

export const isFundedTradeStatus = (status: string): boolean =>
  (FUNDED_TRADE_STATUSES as readonly string[]).includes(status);

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
      // `previousStatus` and `action` are left out when the change would name a review (a cleared hold): the
      // room can hold the counterparty. A client does not read them, only `status`.
      need(
        (v.previousStatus === undefined) === (v.action === undefined),
        'action',
        'previousStatus and action are both present or both withheld',
      );
    }
    if (v.kind === 'DELIVERY_OVERDUE')
      need(v.status !== undefined, 'status', 'DELIVERY_OVERDUE carries status');
    if (v.kind === 'COMPLETED') need(v.via !== undefined, 'via', 'COMPLETED carries how');
    if (v.kind.endsWith('_RESPONDED'))
      need(v.decision !== undefined, 'decision', 'a response carries its decision');
  });
export type TradeUpdate = z.infer<typeof tradeUpdateSchema>;

// ---------------------------------------------------------------------------
// The trades list and the lookup by code (T-068 follow-up, from F-017's review)
// ---------------------------------------------------------------------------

/** Which trades `GET /trades` returns: still moving, finished, or everything. */
export const TRADE_LIST_STATES = ['ALL', 'OPEN', 'CLOSED'] as const;
export const tradeListStateSchema = z.enum(TRADE_LIST_STATES);
export type TradeListState = z.infer<typeof tradeListStateSchema>;

/**
 * Why a trade is waiting on YOU, decided by the server (a pending extension request is not visible to a
 * list row, and the rule must not be copied into three clients). `null` means nothing is asked of you.
 */
export const TRADE_ATTENTION_KINDS = [
  'RESPOND_TO_PROPOSAL',
  'PAY',
  'SHIP',
  'CONFIRM_DELIVERY',
  'INSPECT',
  'RESPOND_TO_EXTENSION',
] as const;
export const tradeAttentionSchema = z.enum(TRADE_ATTENTION_KINDS);
export type TradeAttention = z.infer<typeof tradeAttentionSchema>;

/**
 * The other party as a list row or a header shows them: the fields party lookup already returns to any
 * signed-in user (handle, display name, avatar), and nothing else. No email, phone, legal name,
 * address or verification detail. `null` where the party is not known yet, or has been erased.
 */
export const counterpartyDisplaySchema = z.strictObject({
  publicId: z.string(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type CounterpartyDisplay = z.infer<typeof counterpartyDisplaySchema>;

const tradeRoleSchema = z.enum(['BUYER', 'SELLER']);

export const tradeListItemSchema = z.strictObject({
  id: z.uuid(),
  tradeCode: canonicalTradeCodeSchema,
  status: tradeStatusSchema,
  statusRevision: z.number().int(),
  yourRole: tradeRoleSchema,
  initiatorRole: tradeRoleSchema,
  /** Whose turn it is on an open proposal; `null` once it is not a question of turns. */
  awaiting: z.enum(['YOU', 'COUNTERPARTY']).nullable(),
  attention: tradeAttentionSchema.nullable(),
  counterparty: counterpartyDisplaySchema.nullable(),
  item: z.strictObject({
    /** The first of title, name, model or brand in the item details; `null` if none is a string. */
    title: z.string().nullable(),
    categoryCode: z.string().nullable(),
    categoryName: z.string().nullable(),
  }),
  currency: z.literal('NGN'),
  /** Kobo, as a digit string. The current terms' item price; `null` before there are terms. */
  itemAmountMinor: z.string().nullable(),
  /** Kobo; present once the fees were frozen on acceptance. */
  buyerTotalMinor: z.string().nullable(),
  sentAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /** Newest-relevant first: the list is ordered by this, then by id. */
  updatedAt: z.iso.datetime(),
});
export type TradeListItem = z.infer<typeof tradeListItemSchema>;

export const tradeListResponseSchema = paginatedSchema(tradeListItemSchema);

/**
 * `PARTY`: the caller is the buyer or seller of record and gets the trade as they always see it.
 * `INVITEE`: the caller is the named invitee who has not claimed yet; the trade is previewed (no
 * addresses, no fees) and `POST /trades/:id/claim` with its `id` takes their side.
 */
export const TRADE_ACCESS_KINDS = ['PARTY', 'INVITEE'] as const;

/**
 * The category a trade was proposed in and the version of its Trade Standard the trade pinned, on every
 * single-trade view. A client reads the standard (`proofMedia.minPhotos` and the rest) for exactly
 * `(categoryCode, standardVersion)` instead of inferring a category from the item details. All four are
 * `null` together on a trade with no category.
 */
export const tradeCategoryFieldsSchema = z.object({
  categoryCode: z.string().nullable(),
  categoryName: z.string().nullable(),
  standardVersion: z.number().int().nullable(),
  /**
   * The id of that exact version (`GET /config/trade-standards/versions/:id`). The number alone cannot
   * be resolved once a newer version is published; the id always can. Null with the other three.
   */
  standardVersionId: z.uuid().nullable(),
});

export const tradeByCodeResponseSchema = z.strictObject({
  access: z.enum(TRADE_ACCESS_KINDS),
  trade: z.looseObject({
    id: z.uuid(),
    tradeCode: canonicalTradeCodeSchema,
    status: tradeStatusSchema,
    statusRevision: z.number(),
    yourRole: tradeRoleSchema,
    ...tradeCategoryFieldsSchema.shape,
  }),
  /** The OTHER party: for an invitee, whoever invited them. */
  counterparty: counterpartyDisplaySchema.nullable(),
});
export type TradeByCodeResponse = z.infer<typeof tradeByCodeResponseSchema>;

// ---------------------------------------------------------------------------
// The trade's activity feed (F-022 UI half): what a party may read of its history
// ---------------------------------------------------------------------------

/**
 * What happened, as a closed label. The copy is the client's; the server never sends free text, because the
 * rows it is built from carry deadlines, risk wording and internal ids that a party must not read.
 */
export const TRADE_ACTIVITY_KINDS = [
  'PROPOSAL_SENT',
  'PROPOSAL_HELD',
  'PROPOSAL_NOT_SENT',
  'INVITATION_CLAIMED',
  'TERMS_CHANGED',
  'TERMS_AGREED',
  'PROPOSAL_DECLINED',
  'TRADE_CANCELLED',
  'TRADE_EXPIRED',
  'FUNDS_PROTECTED',
  'SHIPPED',
  'DELIVERY_REPORTED',
  'DELIVERY_CONFIRMED',
  'DELIVERY_ASSUMED',
  'TRADE_COMPLETED',
  'INSPECTION_ELAPSED',
  'SETTLED',
  'REFUNDED',
  'DISPUTE_OPENED',
  'DISPUTE_RESOLVED',
  'DELIVERY_EXTENSION_REQUESTED',
  'DELIVERY_EXTENSION_ACCEPTED',
  'DELIVERY_EXTENSION_DECLINED',
  'DELIVERY_EXTENSION_LAPSED',
  'INSPECTION_EXTENSION_REQUESTED',
  'INSPECTION_EXTENSION_ACCEPTED',
  'INSPECTION_EXTENSION_DECLINED',
  'INSPECTION_EXTENSION_LAPSED',
] as const;
export const tradeActivityKindSchema = z.enum(TRADE_ACTIVITY_KINDS);
export type TradeActivityKind = z.infer<typeof tradeActivityKindSchema>;

/** Who did it, from the reader's side. Staff, the platform and the ledger are all `KOMTRU`. */
export const TRADE_ACTIVITY_ACTORS = ['YOU', 'OTHER_PARTY', 'KOMTRU'] as const;

/** `S:<n>` is a state change, `A:<n>` an activity row. Opaque to a client; unique within a trade. */
export const TRADE_ACTIVITY_ID_PATTERN = /^[SA]:\d{1,18}$/;

export const tradeActivityItemSchema = z.strictObject({
  id: z.string().regex(TRADE_ACTIVITY_ID_PATTERN),
  occurredAt: z.iso.datetime(),
  kind: tradeActivityKindSchema,
  actor: z.enum(TRADE_ACTIVITY_ACTORS),
  /** The status the trade was in after this, for a state change; `null` for the rest. */
  toStatus: tradeStatusSchema.nullable(),
  /** Written by a party on a decline or a cancellation, and only then. Never a staff or system reason. */
  reason: z.string().nullable(),
});
export type TradeActivityItem = z.infer<typeof tradeActivityItemSchema>;

export const tradeActivityResponseSchema = paginatedSchema(tradeActivityItemSchema);
export type TradeActivityResponse = z.infer<typeof tradeActivityResponseSchema>;
