// Pure rules behind `GET /trades/:id/activity` (F-022 UI half): what a party may read of a trade's history,
// and the cursor.
//
// The feed is built from `trade_state_changes` (written by trigger, one row per transition) and a short
// allowlist of `trade_activity` rows. It is built from enum labels only. `trade_activity.summary` and both
// `metadata` columns are written by services for staff and for debugging: they hold deadlines, risk wording,
// request ids, and for a staff transition a staff-written reason. None of that is passed on.
import {
  TRADE_ACTIVITY_ID_PATTERN,
  type TradeActivityItem,
  type TradeActivityKind,
  type TradeStatus,
} from '@komtru/shared-types';
import { ApiError } from '../../../platform/errors.js';
import type { CursorKey } from '../../../platform/http/paginate.js';
import type { TradeInitiatorRole } from './eligibility.js';
import type { TradeAction } from './stateMachine.js';

/** What the reader needs to know about themselves to see the feed their way. */
export interface ActivityViewer {
  role: TradeInitiatorRole;
  /** The proposer may see a proposal held or turned back by review; nobody else may. */
  isInitiator: boolean;
}

/** A row as the union query returns it (every column text, so nothing is rounded on the way). */
export interface ActivityRow {
  src: 'S' | 'A';
  n: string;
  occurredAt: string;
  cursorTs: string;
  actorType: string;
  action: string | null;
  toStatus: string | null;
  reason: string | null;
  event: string | null;
}

/**
 * A trade the counterparty must not learn exists yet: not sent, held for review, or turned back by it.
 * The trades list already hides these (M7 R1); the feed answers the same as a missing trade.
 */
export const HIDDEN_FROM_COUNTERPARTY: readonly TradeStatus[] = [
  'DRAFT',
  'UNDER_PROPOSAL_REVIEW',
  'REJECTED',
];

const ACTION_KIND: Record<TradeAction, TradeActivityKind | null> = {
  SEND: 'PROPOSAL_SENT',
  CLAIM_INVITATION: 'INVITATION_CLAIMED',
  EXPIRE: 'TRADE_EXPIRED',
  CLEAR_REVIEW: 'PROPOSAL_SENT',
  REJECT_REVIEW: 'PROPOSAL_NOT_SENT',
  COUNTER_PROPOSE: 'TERMS_CHANGED',
  ACCEPT: 'TERMS_AGREED',
  DECLINE: 'PROPOSAL_DECLINED',
  CANCEL: 'TRADE_CANCELLED',
  FUND: 'FUNDS_PROTECTED',
  BEGIN_CUSTODY: 'SHIPPED',
  REFUND_CANCELLATION: 'REFUNDED',
  DELIVERY_SIGNAL: 'DELIVERY_REPORTED',
  CONFIRM_RECEIPT: 'DELIVERY_CONFIRMED',
  GRACE_ELAPSED: 'DELIVERY_ASSUMED',
  COMPLETE: 'TRADE_COMPLETED',
  INSPECTION_ELAPSED: 'INSPECTION_ELAPSED',
  SETTLE: 'SETTLED',
  DISPUTE: 'DISPUTE_OPENED',
  RESOLVE_DISPUTE: 'DISPUTE_RESOLVED',
};

/** The only `trade_activity` rows that reach a party, by the `event` they were written with. */
export const ACTIVITY_EVENT_KIND: Record<string, TradeActivityKind> = {
  EXTENSION_REQUESTED: 'DELIVERY_EXTENSION_REQUESTED',
  EXTENSION_ACCEPTED: 'DELIVERY_EXTENSION_ACCEPTED',
  EXTENSION_DECLINED: 'DELIVERY_EXTENSION_DECLINED',
  EXTENSION_LAPSED: 'DELIVERY_EXTENSION_LAPSED',
  INSPECTION_EXTENSION_REQUESTED: 'INSPECTION_EXTENSION_REQUESTED',
  INSPECTION_EXTENSION_ACCEPTED: 'INSPECTION_EXTENSION_ACCEPTED',
  INSPECTION_EXTENSION_DECLINED: 'INSPECTION_EXTENSION_DECLINED',
  INSPECTION_EXTENSION_LAPSED: 'INSPECTION_EXTENSION_LAPSED',
};
export const ACTIVITY_EVENTS = Object.keys(ACTIVITY_EVENT_KIND);

/** The two review outcomes only the proposer may see: a `SEND` that went into review, and a rejection. */
export const isReviewRowForInitiatorOnly = (row: Pick<ActivityRow, 'src' | 'action' | 'toStatus'>): boolean =>
  row.src === 'S' &&
  (row.action === 'REJECT_REVIEW' || (row.action === 'SEND' && row.toStatus === 'UNDER_PROPOSAL_REVIEW'));

const PARTY_REASON_ACTIONS: readonly string[] = ['DECLINE', 'CANCEL'];
const REASON_MAX = 500;

/**
 * One feed row, or `null` for a row this reader may not see. The actor is the reader's side: the platform,
 * the ledger, logistics and staff are one `KOMTRU`, so a party cannot tell automation from a person on staff.
 */
export function toActivityItem(row: ActivityRow, viewer: ActivityViewer): TradeActivityItem | null {
  let kind: TradeActivityKind | null;
  if (row.src === 'S') {
    if (!viewer.isInitiator && isReviewRowForInitiatorOnly(row)) return null;
    kind = ACTION_KIND[row.action as TradeAction] ?? null;
    if (row.action === 'SEND' && row.toStatus === 'UNDER_PROPOSAL_REVIEW') kind = 'PROPOSAL_HELD';
  } else {
    kind = row.event === null ? null : (ACTIVITY_EVENT_KIND[row.event] ?? null);
  }
  if (kind === null) return null;

  const byParty = row.actorType === 'BUYER' || row.actorType === 'SELLER';
  const actor = byParty ? (row.actorType === viewer.role ? 'YOU' : 'OTHER_PARTY') : 'KOMTRU';
  const reason =
    row.src === 'S' &&
    byParty &&
    row.action !== null &&
    PARTY_REASON_ACTIONS.includes(row.action) &&
    row.reason !== null &&
    row.reason.trim().length > 0
      ? row.reason.trim().slice(0, REASON_MAX)
      : null;

  return {
    id: `${row.src}:${row.n}`,
    occurredAt: new Date(row.occurredAt).toISOString(),
    kind,
    actor,
    toStatus: row.src === 'S' ? (row.toStatus as TradeStatus | null) : null,
    reason,
  };
}

// ---------------------------------------------------------------------------
// The cursor
// ---------------------------------------------------------------------------

/**
 * `(occurred_at, source, id)` descending, and the trade it was issued for. The time is the database's own
 * microsecond text, never a JS Date, which keeps milliseconds and would skip or repeat rows sharing one.
 */
export const tradeActivityCursor = (
  row: Pick<ActivityRow, 'src' | 'n' | 'cursorTs'>,
  tradeId: string,
): CursorKey => ({
  t: row.cursorTs,
  id: `${row.src}:${row.n}`,
  f: tradeId,
});

const MICRO_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const wrongActivityCursor = (): ApiError =>
  new ApiError(422, 'VALIDATION_FAILED', 'Invalid cursor', 'Use the nextCursor from the previous page');

/**
 * Strict on every field and on the field set (T-052's and T-107's finding: a cursor read leniently restarts
 * at page 1 and the client loops forever). Anything that is not exactly what `tradeActivityCursor` makes,
 * for this trade, is a 422 raised before any query.
 */
export function readTradeActivityCursor(
  cursor: CursorKey | undefined,
  tradeId: string,
): { ts: string; src: 'S' | 'A'; n: string } | undefined {
  if (cursor === undefined) return undefined;
  const { t, id, f } = cursor;
  const valid =
    Object.keys(cursor).sort().join(',') === 'f,id,t' &&
    typeof t === 'string' &&
    MICRO_ISO.test(t) &&
    !Number.isNaN(Date.parse(t)) &&
    typeof id === 'string' &&
    TRADE_ACTIVITY_ID_PATTERN.test(id) &&
    typeof f === 'string' &&
    UUID.test(f) &&
    f.toLowerCase() === tradeId.toLowerCase();
  if (!valid) throw wrongActivityCursor();
  const [src, n] = id.split(':') as ['S' | 'A', string];
  return { ts: t, src, n };
}
