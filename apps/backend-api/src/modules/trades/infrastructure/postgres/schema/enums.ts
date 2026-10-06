// The reconciled lifecycle (design §6, conflict C1). Where M7 and design §6 disagree, §6 wins:
// M7's SELLER_ACCEPTED, READY_TO_SHIP, IN_TRANSIT, DELIVERED and UNDER_REVIEW are not states here.
// The seller accepts before funding, dispatch is locked until funding (X1), and delivery is an
// event and a timestamp rather than a resting place, because inspection starts the moment delivery
// is trusted.
import { trade } from './columns.js';

/** Design §6.1, in lifecycle order. The order is load-bearing: it is what "forwards" means. */
export const tradeStatus = trade.enum('trade_status', [
  'DRAFT',
  'PENDING_COUNTERPARTY', // counterparty invited, not yet a user (M1 party invitation)
  'UNDER_PROPOSAL_REVIEW', // a risk rule holds a stranger's proposal (HTML N1/N2, G3)
  'AWAITING_ACCEPTANCE',
  'PENDING_PAYMENT', // accepted; "do not ship yet" (W3)
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
  // Pre-funding terminals.
  'DECLINED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
]);

/**
 * Every transition in design §6.2 is one of these. The action is recorded with the state change
 * because a (from, to) pair is ambiguous on its own: FUNDED → CANCELLED_REFUNDED is reached by an
 * approved buyer cancellation, a seller who cannot fulfil, and an overdue delivery alike.
 */
export const tradeAction = trade.enum('trade_action', [
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
]);

/** The side the person who started the trade takes; the counterparty takes the other (design §6.3). */
export const tradeInitiatorRole = trade.enum('trade_initiator_role', ['BUYER', 'SELLER']);

/** Who caused a state change. LEDGER is M8 answering a funding or release request. */
export const tradeActorType = trade.enum('trade_actor_type', [
  'BUYER',
  'SELLER',
  'SYSTEM',
  'STAFF',
  'LEDGER',
  'LOGISTICS',
]);

/**
 * The append-only lifecycle log's vocabulary (conflict C6: rejections are logged here, resolving
 * m2 §13.1). Later flow tickets add labels; a label is never removed, because old rows keep it.
 */
export const tradeActivityType = trade.enum('trade_activity_type', [
  'PROPOSAL_SENT',
  'COUNTER_PROPOSED',
  'PROPOSAL_ACCEPTED',
  'PROPOSAL_DECLINED',
  'PROPOSAL_REJECTED',
  'PROPOSAL_CLEARED',
  'ELIGIBILITY_BLOCKED',
  'HOLD_PLACED',
  'HOLD_RELEASED',
  'DEADLINE_SET',
  'DEADLINE_EXTENDED',
  'DEADLINE_ELAPSED',
  'DELIVERY_SIGNAL_RECORDED',
  'ESCROW_ACTION_REQUESTED',
  'ESCROW_ACTION_SETTLED',
  'NOTE',
]);

/** M2's provenance vocabulary, extended with PARK_CUSTODY (conflict C3). */
export const deliverySignalSource = trade.enum('delivery_signal_source', [
  'BUYER_CONFIRMATION',
  'SELLER_SELF_REPORT',
  'PARTNER_PORTAL',
  'PARK_CUSTODY',
  'COURIER_API',
]);

export const escrowActionType = trade.enum('escrow_action_type', [
  'FUND',
  'RELEASE',
  'REFUND',
  'PARTIAL_REFUND',
]);

export const escrowActionStatus = trade.enum('escrow_action_status', [
  'REQUESTED',
  'ACKNOWLEDGED',
  'COMPLETED',
  'FAILED',
]);

// M7 §4.1's six, plus the two post-funding reasons design §6.2 adds to the FUNDED branch.
export const cancellationReason = trade.enum('cancellation_reason', [
  'BUYER_WITHDREW',
  'SELLER_WITHDREW',
  'COUNTERPARTY_INVITE_EXPIRED',
  'MUTUAL_AGREEMENT',
  'FRAUD_SUSPECTED',
  'SYSTEM_TIMEOUT',
  'SELLER_CANNOT_FULFIL',
  'DELIVERY_OVERDUE',
]);

/** Holds are not states (design §6.2): they freeze auto-transitions without hiding where a trade is. */
export const tradeHoldSource = trade.enum('trade_hold_source', ['PARK_EXCEPTION', 'RISK', 'ADMIN']);

/** The six scheduled deadlines design §6.2 names. */
export const tradeDeadlineKind = trade.enum('trade_deadline_kind', [
  'COUNTERPARTY_EXPIRY',
  'PAYMENT',
  'DELIVERY',
  'UNCONFIRMED_DELIVERY_GRACE',
  'INSPECTION',
  'MEDIATION',
]);

export const tradeDeadlineStatus = trade.enum('trade_deadline_status', [
  'PENDING',
  'MET',
  'ELAPSED',
  'CANCELLED',
]);
