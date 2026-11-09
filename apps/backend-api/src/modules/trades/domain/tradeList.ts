// Pure rules behind `GET /trades` (T-068 follow-up): what is waiting on the caller, how a row is titled,
// and the cursor.
import { TRADE_LIST_STATES, type TradeAttention, type TradeListState } from '@komtru/shared-types';
import { ApiError } from '../../../platform/errors.js';
import type { CursorKey } from '../../../platform/http/paginate.js';
import type { TradeInitiatorRole } from './eligibility.js';
import type { TradeStatus } from './stateMachine.js';

export interface AttentionFacts {
  status: TradeStatus;
  yourRole: TradeInitiatorRole;
  /** `viewTrade`'s turn indicator on an open proposal. */
  awaiting: 'YOU' | 'COUNTERPARTY' | null;
  /** A seller's request for more delivery time is waiting on the buyer (DE1). */
  pendingDeliveryExtension: boolean;
  /** A buyer's request for more inspection time is waiting on the seller (BEI1). */
  pendingInspectionExtension: boolean;
}

/**
 * What this trade is asking of the caller, or null. Decided here so a list row, a badge and a push all
 * agree, and so a pending extension request (invisible to a row) can count.
 *
 * Deliberately narrow: only a step the caller can take now that the trade is waiting on. A proposal
 * waiting on the other party, a shipment in transit and a closed trade ask nothing. A held proposal
 * (UNDER_PROPOSAL_REVIEW) and a draft ask nothing either: they are not waiting on the other party.
 */
export function attentionFor(f: AttentionFacts): TradeAttention | null {
  switch (f.status) {
    case 'AWAITING_ACCEPTANCE':
      return f.awaiting === 'YOU' ? 'RESPOND_TO_PROPOSAL' : null;
    case 'PENDING_PAYMENT':
      return f.yourRole === 'BUYER' ? 'PAY' : null;
    case 'FUNDED':
      if (f.yourRole === 'BUYER') return f.pendingDeliveryExtension ? 'RESPOND_TO_EXTENSION' : null;
      return 'SHIP';
    case 'UNCONFIRMED_DELIVERY':
      return f.yourRole === 'BUYER' ? 'CONFIRM_DELIVERY' : null;
    case 'INSPECTION':
      if (f.yourRole === 'BUYER') return 'INSPECT';
      return f.pendingInspectionExtension ? 'RESPOND_TO_EXTENSION' : null;
    default:
      return null;
  }
}

const TITLE_KEYS = ['title', 'name', 'model', 'brand'] as const;
const TITLE_MAX = 80;

/** The item details are free-form per category; a row shows the first plausible label, bounded. */
export function itemTitle(spec: unknown): string | null {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return null;
  for (const key of TITLE_KEYS) {
    const value = (spec as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim().slice(0, TITLE_MAX);
  }
  return null;
}

// ---------------------------------------------------------------------------
// The cursor
// ---------------------------------------------------------------------------

/**
 * `(updated_at, id)` descending, plus the filter the cursor was issued for. The time is the database's
 * own microsecond text (`cursorTs`), never a JS Date: a Date keeps milliseconds, and a cursor that
 * rounds a time down would skip or repeat every row sharing that millisecond.
 */
export const tradeListCursor = (row: { cursorTs: string; id: string }, state: TradeListState): CursorKey => ({
  t: row.cursorTs,
  id: row.id,
  f: state,
});

const MICRO_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const wrongTradeListCursor = (): ApiError =>
  new ApiError(422, 'VALIDATION_FAILED', 'Invalid cursor', 'Use the nextCursor from the previous page');

/**
 * Strict on every field, and on the field SET. T-052's and T-107's reviews found a cursor read with
 * `typeof` checks that quietly ignored what it did not understand, so a mangled one restarted at page 1
 * and the client looped forever. Anything that is not exactly the key `tradeListCursor` makes, for the
 * same filter, is a 422.
 */
export function readTradeListCursor(
  cursor: CursorKey | undefined,
  state: TradeListState,
): { ts: string; id: string } | undefined {
  if (cursor === undefined) return undefined;
  const keys = Object.keys(cursor).sort().join(',');
  const { t, id, f } = cursor;
  const valid =
    keys === 'f,id,t' &&
    typeof t === 'string' &&
    MICRO_ISO.test(t) &&
    !Number.isNaN(Date.parse(t)) &&
    typeof id === 'string' &&
    UUID.test(id) &&
    typeof f === 'string' &&
    (TRADE_LIST_STATES as readonly string[]).includes(f) &&
    f === state;
  if (!valid) throw wrongTradeListCursor();
  return { ts: t, id };
}
