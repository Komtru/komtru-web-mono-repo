// What a dispute needs from modules it must not reach into, as ports (T-065, the shape
// trades/services/fulfilmentPorts.ts established). Two reasons they are ports rather than direct
// reads: the module-boundaries rule means every cross-module read goes through a barrel anyway,
// and the evidence-comparison read model (T-081) is far easier to test when the trade's media and
// the Park custody photos are things a fixture can hand over.
import type { Db } from '../../../db/index.js';
import type { Tx } from '../../../platform/events/publish.js';
import type { DisputeCategory } from '../domain/types.js';

/** The trade facts a dispute snapshots when it opens. Everything else it asks for at read time. */
export interface DisputableTrade {
  tradeId: string;
  tradeCode: string;
  status: string;
  buyerUserId: string;
  sellerUserId: string;
  orderId: string | null;
  /**
   * The escrowed ITEM amount, which is what a decision divides. Not the buyer's total: the ledger
   * funds the item and the buyer protection fee into two separate liabilities (T-072) and settles
   * against the item.
   */
  itemAmountMinor: bigint;
  currency: string;
}

/** One piece of media already on the trade, as the comparison view shows it. */
export interface TradeMedia {
  id: string;
  fileRefId: string;
  event: 'DISPATCH' | 'DELIVERY' | 'INSPECTION' | 'ISSUE';
  uploadedByUserId: string;
  capturedAt: Date;
}

export interface CustodyPhoto {
  id: string;
  fileRefId: string;
  hubName: string | null;
  takenAt: Date;
}

export interface TimelineEntry {
  at: Date;
  kind: string;
  detail: string | null;
}

export interface DisputePorts {
  db: Db;
  now: () => Date;

  /** Null when the trade does not exist or the caller is not a party to it. */
  tradeForDispute: (tx: Tx, input: { tradeId: string; userId: string }) => Promise<DisputableTrade | null>;

  /**
   * M7 owns the trade's state machine, so this asks M7 to move it rather than writing `trades`.
   * Path A: the trade goes to `DISPUTED` in the same transaction the case is created in, so the
   * two systems can never disagree about whether a trade is under dispute (M3 D1).
   */
  moveTradeToDisputed: (tx: Tx, input: { tradeId: string; actorUserId: string }) => Promise<void>;

  /** T-081: the seller's pre-shipment proof and the buyer's unboxing photos, from the trade. */
  tradeMedia: (tx: Tx, tradeId: string) => Promise<TradeMedia[]>;
  /** T-081: present only when the trade went through a Park hub. Empty otherwise. */
  custodyPhotos: (tx: Tx, tradeId: string) => Promise<CustodyPhoto[]>;
  /** T-081: the shipment or parcel timeline the comparison view sits beside. */
  shipmentTimeline: (tx: Tx, tradeId: string) => Promise<TimelineEntry[]>;

  /**
   * M20: give the two parties and (once assigned) the reviewer a PRIVATE_CASE grant on a
   * DISPUTE_EVIDENCE file. The grant is what makes the evidence readable at all.
   */
  grantEvidenceAccess: (tx: Tx, input: { fileRefId: string; userIds: readonly string[] }) => Promise<void>;

  /**
   * T-080's reviewer exclusion. Returns the users known to share a device, or a payout instrument,
   * with either party.
   *
   * SEAM(T-080): identity exposes no shared-device signal and the ledger exposes no shared-payout
   * signal today, so the production adapter answers with empty lists and the exclusion is inert.
   * The RULE is complete and tested (domain/assignment.ts); only this adapter is waiting. Recorded
   * as a parked question rather than quietly dropped — a reviewer sharing a phone with a seller is
   * exactly the conflict D3 exists to prevent, and shipping it inert is a decision the owner
   * should make knowingly.
   */
  relatedUsers: (
    tx: Tx,
    input: { buyerUserId: string; sellerUserId: string },
  ) => Promise<{ sharedDeviceUserIds: string[]; sharedPayoutUserIds: string[] }>;

  /** Config, read lazily so a value is never frozen at boot. */
  mediationWindowHours: () => Promise<number>;
  evidenceWindowDays: () => Promise<number>;
  appealWindowDays: () => Promise<number>;
}

/** The categories a party may choose when filing directly; staff escalation may use any. */
export const PARTY_CATEGORIES: readonly DisputeCategory[] = [
  'ITEM_NOT_RECEIVED',
  'ITEM_NOT_AS_DESCRIBED',
  'PAYMENT_ISSUE',
  'OTHER',
];

/**
 * The trade states a dispute may be opened from. M7's inspection-window gate already decided
 * eligibility (M3 §1 puts that out of scope here); this is the coarse "is there money to argue
 * about" check, matching the trades machine's own DISPUTE edges.
 */
export const DISPUTABLE_TRADE_STATUSES: readonly string[] = ['SHIPPED', 'UNCONFIRMED_DELIVERY', 'INSPECTION'];

/** SEAM(T-080): empty lists until identity and the ledger can answer. See `relatedUsers`. */
export const noRelatedUsers: DisputePorts['relatedUsers'] = () =>
  Promise.resolve({ sharedDeviceUserIds: [], sharedPayoutUserIds: [] });
