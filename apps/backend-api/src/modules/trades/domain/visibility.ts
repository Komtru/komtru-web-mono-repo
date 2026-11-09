// WHO MAY KNOW A TRADE EXISTS, in one place (M7 R1, T-062).
//
// A proposal held for TrustOps review, one turned back by it, and a draft are invisible to the party they
// were addressed to; only the proposer sees them. Before this file that rule lived in four places that had
// already drifted (the list hid two statuses, the activity feed three, and the view, the code lookup, the
// decline and cancel routes and the room authoriser none), so a bound counterparty could read a held
// proposal, see the proposer's address, and cancel a review in progress. Everything that answers "may this
// person see this trade" now asks `canSeeTrade`; the list builds its SQL from the same constants.
//
// Nothing produces `UNDER_PROPOSAL_REVIEW` until T-062. The gate is built now so that ticket does not have
// to remember every door.
import type { TradeStatus } from '@komtru/shared-types';

/** The two statuses a review puts a proposal in. */
export const REVIEW_STATUSES = [
  'UNDER_PROPOSAL_REVIEW',
  'REJECTED',
] as const satisfies readonly TradeStatus[];

/** Statuses the counterparty must never see a trade in. A draft is nobody else's yet. */
export const HIDDEN_STATUSES = ['DRAFT', ...REVIEW_STATUSES] as const satisfies readonly TradeStatus[];

/**
 * A trade the proposer withdrew while it was held or still a draft is `CANCELLED`, and to the other party it
 * must read as "never existed": the status alone cannot say, so the status it left is part of the rule.
 */
export const HIDDEN_AFTER_CANCEL_FROM = [
  'DRAFT',
  'UNDER_PROPOSAL_REVIEW',
] as const satisfies readonly TradeStatus[];

const includes = (list: readonly string[], value: string | null): boolean =>
  value !== null && list.includes(value);

export interface VisibleTrade {
  status: TradeStatus;
  /** The status the last transition left; the database stamps it, never a caller. */
  previousStatus: TradeStatus | null;
  initiatorUserId: string;
}

/** True when a person who is NOT the proposer may not learn this trade exists. */
export function isHiddenFromCounterparty(trade: Pick<VisibleTrade, 'status' | 'previousStatus'>): boolean {
  return (
    includes(HIDDEN_STATUSES, trade.status) ||
    (trade.status === 'CANCELLED' && includes(HIDDEN_AFTER_CANCEL_FROM, trade.previousStatus))
  );
}

/** The one question every read and every action asks. The proposer always sees their own trade. */
export const canSeeTrade = (trade: VisibleTrade, userId: string): boolean =>
  trade.initiatorUserId === userId || !isHiddenFromCounterparty(trade);

/**
 * What a state change may tell the trade's room (which the counterparty can already be in).
 * - `SEND`: no hold is touched.
 * - `REDACT`: a review cleared. The room hears that the trade is now awaiting an answer, and not what it was
 *   or which action did it (`CLEAR_REVIEW` would announce that a review happened).
 * - `WITHHOLD`: the change is one the counterparty must not know about (into review, turned back, or the
 *   proposer withdrawing a held proposal). Nothing is pushed; the proposer reads it when they next look.
 */
export type PushDisposition = 'SEND' | 'REDACT' | 'WITHHOLD';

export function pushDisposition(from: TradeStatus, to: TradeStatus): PushDisposition {
  const intoReview = includes(REVIEW_STATUSES, to);
  const outOfReview = from === 'UNDER_PROPOSAL_REVIEW';
  if (!intoReview && !outOfReview) return 'SEND';
  return outOfReview && to === 'AWAITING_ACCEPTANCE' ? 'REDACT' : 'WITHHOLD';
}
