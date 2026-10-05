// The reconciled trade lifecycle (design §6.2, conflict C1). Pure: no database, no clock, no I/O.
// This map is the single definition of the machine. The database holds the same edges, emitted from
// here by stateMachineSql.ts into migration 0018, and a test compares the two on every run — so a
// service that forgets the guard, a job that updates `status` directly and a stray psql session are
// all refused the same jumps.
//
// `canTransition(action, from)` returns the states that action may reach, because design §6.2 gives
// four actions more than one outcome (SEND, CLAIM_INVITATION, DELIVERY_SIGNAL, RESOLVE_DISPUTE).
// The caller names the target it intends and the whole triple is validated, here and in Postgres.

/** Design §6.1, in lifecycle order. The order is what "forwards" means (see the forward-only test). */
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

export type TradeStatus = (typeof TRADE_STATUSES)[number];

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

export type TradeAction = (typeof TRADE_ACTIONS)[number];

type TransitionMap = Readonly<
  Record<TradeAction, Readonly<Partial<Record<TradeStatus, readonly TradeStatus[]>>>>
>;

export const TRANSITIONS: TransitionMap = {
  // The three send branches: an invited non-user, a risk hold on a stranger's proposal (N1/N2, G3),
  // or straight to the counterparty.
  SEND: { DRAFT: ['PENDING_COUNTERPARTY', 'UNDER_PROPOSAL_REVIEW', 'AWAITING_ACCEPTANCE'] },
  CLAIM_INVITATION: { PENDING_COUNTERPARTY: ['UNDER_PROPOSAL_REVIEW', 'AWAITING_ACCEPTANCE'] },
  // The 14-day invitation window (M1 §8) and the payment deadline.
  EXPIRE: { PENDING_COUNTERPARTY: ['EXPIRED'], PENDING_PAYMENT: ['EXPIRED'] },
  CLEAR_REVIEW: { UNDER_PROPOSAL_REVIEW: ['AWAITING_ACCEPTANCE'] },
  REJECT_REVIEW: { UNDER_PROPOSAL_REVIEW: ['REJECTED'] },
  // W2/BR1: a counter-proposal is a new terms version and a flipped turn, not a new state.
  COUNTER_PROPOSE: { AWAITING_ACCEPTANCE: ['AWAITING_ACCEPTANCE'] },
  // W1/W3: acceptance comes before funding, and the trade waits at "do not ship yet".
  ACCEPT: { AWAITING_ACCEPTANCE: ['PENDING_PAYMENT'] },
  DECLINE: { AWAITING_ACCEPTANCE: ['DECLINED'] },
  // M7 D3: before FUNDED a trade can simply be cancelled; after it, only refunded.
  CANCEL: {
    DRAFT: ['CANCELLED'],
    PENDING_COUNTERPARTY: ['CANCELLED'],
    UNDER_PROPOSAL_REVIEW: ['CANCELLED'],
    AWAITING_ACCEPTANCE: ['CANCELLED'],
    PENDING_PAYMENT: ['CANCELLED'],
  },
  FUND: { PENDING_PAYMENT: ['FUNDED'] },
  // Custody begins: self-arranged waybill evidence (X2), a courier package SHIPPED, or a Park
  // parcel AT_SOURCE_HUB. Dispatch before funding is refused here as well as at the endpoint (X1).
  BEGIN_CUSTODY: { FUNDED: ['SHIPPED'] },
  // CR1/CR2 approved cancellation, SC1 seller cannot fulfil, DE3 delivery overdue.
  REFUND_CANCELLATION: { FUNDED: ['CANCELLED_REFUNDED'] },
  // Trust weighting (M7 §6) chooses the target; this module only says both are reachable.
  DELIVERY_SIGNAL: { SHIPPED: ['INSPECTION', 'UNCONFIRMED_DELIVERY'] },
  CONFIRM_RECEIPT: { UNCONFIRMED_DELIVERY: ['INSPECTION'] },
  GRACE_ELAPSED: { UNCONFIRMED_DELIVERY: ['INSPECTION'] },
  COMPLETE: { INSPECTION: ['COMPLETED'] },
  INSPECTION_ELAPSED: { INSPECTION: ['COMPLETED'] },
  // The ledger answers trade.completed with payment.escrow_released.
  SETTLE: { COMPLETED: ['SETTLED'] },
  DISPUTE: { SHIPPED: ['DISPUTED'], UNCONFIRMED_DELIVERY: ['DISPUTED'], INSPECTION: ['DISPUTED'] },
  RESOLVE_DISPUTE: { DISPUTED: ['RESOLVED_REFUNDED', 'RESOLVED_RELEASED'] },
};

const NONE: readonly TradeStatus[] = [];

/** The states `action` may reach from `from`; empty when the action does not apply there. */
export const canTransition = (action: TradeAction, from: TradeStatus): readonly TradeStatus[] =>
  TRANSITIONS[action][from] ?? NONE;

export const isTransitionAllowed = (action: TradeAction, from: TradeStatus, to: TradeStatus): boolean =>
  canTransition(action, from).includes(to);

/**
 * The states an action may leave to reach `to`, in lifecycle order. This is what makes the guarded
 * UPDATE possible: `WHERE id = $1 AND status IN (…)` lets the database decide the race, so no
 * caller ever reads a status and then writes one.
 */
export const sourceStatuses = (action: TradeAction, to: TradeStatus): readonly TradeStatus[] =>
  TRADE_STATUSES.filter((from) => isTransitionAllowed(action, from, to));

/** A state with no way out. Everything downstream (deadlines, jobs, holds) stops here. */
export const TERMINAL_STATUSES: readonly TradeStatus[] = TRADE_STATUSES.filter((status) =>
  TRADE_ACTIONS.every((action) => canTransition(action, status).length === 0),
);

export const isTerminal = (status: TradeStatus): boolean => TERMINAL_STATUSES.includes(status);

/** Every edge, as (action, from, to) triples — the form the SQL generator and the parity test use. */
export const transitionTriples = (): [TradeAction, TradeStatus, TradeStatus][] =>
  TRADE_ACTIONS.flatMap((action) =>
    TRADE_STATUSES.flatMap((from) =>
      canTransition(action, from).map((to): [TradeAction, TradeStatus, TradeStatus] => [action, from, to]),
    ),
  );
