// The canned platform data. Every value is typed against the contracts the apps parse (`@komtru/shared-types`
// for the lists, `@komtru/api-client` for the rest), and `startStandin` parses the whole set against those
// schemas before it serves a byte, so a field the contract renamed fails here, at startup, rather than as a
// quietly blank screen. Dates, ids and amounts are fixed: a screenshot is only comparable with another if the
// data behind it did not move.
import type {
  Dispute,
  DisputeDetail,
  DisputeEvidence,
  DisputeTimelineEntry,
  EvidenceComparison,
  Me,
  MerchantApplication,
  MerchantApplicationStatus,
  PaymentStatus,
  Payout,
  PayoutAccount,
  PayoutSummary,
  ShipOptions,
  TradeStandard,
  TradeView,
  VerificationStatus,
} from '@komtru/api-client';
import type { Address, TradeActivityResponse, TradeListItem, ViewerFacts } from '@komtru/shared-types';
import { FUNDED_TRADE_STATUSES } from '@komtru/shared-types';

import { PERSONAS, type PersonaId, type ScenarioId } from './personas.ts';

/** The fixture trades, by name. A walk names one of these ids in its route. */
export const TRADE_IDS = {
  buyerFunded: '0190b0a0-0000-7000-8000-000000000501',
  buyerPending: '0190b0a0-0000-7000-8000-000000000502',
  buyerInspection: '0190b0a0-0000-7000-8000-000000000503',
  buyerDisputed: '0190b0a0-0000-7000-8000-000000000504',
  sellerShipped: '0190b0a0-0000-7000-8000-000000000511',
  sellerProposal: '0190b0a0-0000-7000-8000-000000000512',
  // F-069/F-073 deliver & inspect
  buyerShipped: '0190b0a0-0000-7000-8000-000000000505',
  buyerSettled: '0190b0a0-0000-7000-8000-000000000506',
  // F-069/F-073 fulfil & payouts
  sellerFunded: '0190b0a0-0000-7000-8000-000000000513',
  sellerFundedTwo: '0190b0a0-0000-7000-8000-000000000514',
  sellerInspection: '0190b0a0-0000-7000-8000-000000000515',
  sellerSettled: '0190b0a0-0000-7000-8000-000000000516',
} as const;

/** The one dispute in the fixtures: the buyer's, on `buyerDisputed`. */
const DISPUTE_ID = '0190b0a0-0000-7000-8000-000000000601';
/** One published Trade Standard version per category. A trade pins the version for its own category. */
const STANDARD_VERSION_IDS: Readonly<Record<string, string>> = {
  PHONES: '0190b0a0-0000-7000-8000-000000000901',
  FURNITURE: '0190b0a0-0000-7000-8000-000000000902',
  APPLIANCES: '0190b0a0-0000-7000-8000-000000000903',
  ELECTRONICS: '0190b0a0-0000-7000-8000-000000000904',
};
const TERMS_VERSION_ID = '0190b0a0-0000-7000-8000-000000000909';
const APPLICATION_ID = '0190b0a0-0000-7000-8000-000000000701';
const STATE_ID = '0190b0a0-0000-7000-8000-000000000721';
const CITY_IDS = {
  lekki: '0190b0a0-0000-7000-8000-000000000722',
  ikeja: '0190b0a0-0000-7000-8000-000000000723',
} as const;
const PAYOUT_ACCOUNT_ID = '0190b0a0-0000-7000-8000-000000000741';
const ADDRESS_IDS = {
  buyer: '0190b0a0-0000-7000-8000-000000000731',
  seller: '0190b0a0-0000-7000-8000-000000000732',
} as const;
/** The payment attempt that funded each funded trade. */
const PAYMENT_ATTEMPT_IDS: Readonly<Record<string, string>> = {
  [TRADE_IDS.buyerFunded]: '0190b0a0-0000-7000-8000-000000000801',
  [TRADE_IDS.buyerInspection]: '0190b0a0-0000-7000-8000-000000000803',
  [TRADE_IDS.buyerDisputed]: '0190b0a0-0000-7000-8000-000000000804',
  [TRADE_IDS.sellerShipped]: '0190b0a0-0000-7000-8000-000000000811',
  // F-069/F-073 deliver & inspect
  [TRADE_IDS.buyerShipped]: '0190b0a0-0000-7000-8000-000000000805',
  [TRADE_IDS.buyerSettled]: '0190b0a0-0000-7000-8000-000000000806',
  // F-069/F-073 fulfil & payouts
  [TRADE_IDS.sellerFunded]: '0190b0a0-0000-7000-8000-000000000813',
  [TRADE_IDS.sellerFundedTwo]: '0190b0a0-0000-7000-8000-000000000814',
  [TRADE_IDS.sellerInspection]: '0190b0a0-0000-7000-8000-000000000815',
  [TRADE_IDS.sellerSettled]: '0190b0a0-0000-7000-8000-000000000816',
};

const SELLER_CARD = {
  publicId: 'KMT-PUB-0002',
  username: 'tunde.bello',
  displayName: 'Tunde Bello',
  avatarUrl: null,
};
const BUYER_CARD = {
  publicId: 'KMT-PUB-0001',
  username: 'ada.okafor',
  displayName: 'Ada Okafor',
  avatarUrl: null,
};

const BUYER_TRADES: TradeListItem[] = [
  {
    id: TRADE_IDS.buyerFunded,
    tradeCode: 'KMT-88213-NG',
    status: 'FUNDED',
    statusRevision: 4,
    yourRole: 'BUYER',
    initiatorRole: 'SELLER',
    awaiting: null,
    attention: null,
    counterparty: SELLER_CARD,
    item: { title: 'Samsung Galaxy A34 128GB', categoryCode: 'PHONES', categoryName: 'Phones' },
    currency: 'NGN',
    itemAmountMinor: '18500000',
    buyerTotalMinor: '19250000',
    sentAt: '2026-11-14T09:12:00.000Z',
    createdAt: '2026-11-14T08:50:00.000Z',
    updatedAt: '2026-11-15T10:04:00.000Z',
  },
  {
    id: TRADE_IDS.buyerPending,
    tradeCode: 'KMT-88230-NG',
    status: 'PENDING_PAYMENT',
    statusRevision: 2,
    yourRole: 'BUYER',
    initiatorRole: 'BUYER',
    awaiting: 'YOU',
    attention: 'PAY',
    counterparty: SELLER_CARD,
    item: { title: 'Mesh office chair', categoryCode: 'FURNITURE', categoryName: 'Furniture' },
    currency: 'NGN',
    itemAmountMinor: '4500000',
    buyerTotalMinor: '4680000',
    sentAt: '2026-11-17T16:30:00.000Z',
    createdAt: '2026-11-17T16:20:00.000Z',
    updatedAt: '2026-11-17T16:30:00.000Z',
  },
  {
    id: TRADE_IDS.buyerInspection,
    tradeCode: 'KMT-88262-NG',
    status: 'INSPECTION',
    statusRevision: 6,
    yourRole: 'BUYER',
    initiatorRole: 'SELLER',
    awaiting: 'YOU',
    attention: 'INSPECT',
    counterparty: SELLER_CARD,
    item: { title: 'Hisense 1.5HP split AC', categoryCode: 'APPLIANCES', categoryName: 'Appliances' },
    currency: 'NGN',
    itemAmountMinor: '6400000',
    buyerTotalMinor: '6720000',
    sentAt: '2026-11-13T08:00:00.000Z',
    createdAt: '2026-11-13T07:50:00.000Z',
    updatedAt: '2026-11-17T06:50:00.000Z',
  },
  {
    id: TRADE_IDS.buyerDisputed,
    tradeCode: 'KMT-88244-NG',
    status: 'DISPUTED',
    statusRevision: 7,
    yourRole: 'BUYER',
    initiatorRole: 'SELLER',
    awaiting: null,
    attention: null,
    counterparty: SELLER_CARD,
    item: { title: 'JBL Flip 6', categoryCode: 'ELECTRONICS', categoryName: 'Electronics' },
    currency: 'NGN',
    itemAmountMinor: '9800000',
    buyerTotalMinor: '10290000',
    sentAt: '2026-11-10T10:00:00.000Z',
    createdAt: '2026-11-10T09:40:00.000Z',
    updatedAt: '2026-11-17T09:00:00.000Z',
  },
  // F-069/F-073 deliver & inspect: the trade the workspace reference draws (in transit), and one that is complete.
  {
    id: TRADE_IDS.buyerShipped,
    tradeCode: 'KMT-90428-NG',
    status: 'SHIPPED',
    statusRevision: 5,
    yourRole: 'BUYER',
    initiatorRole: 'SELLER',
    awaiting: null,
    attention: null,
    counterparty: SELLER_CARD,
    item: { title: 'iPhone 13 Pro, 256GB', categoryCode: 'PHONES', categoryName: 'Phones' },
    currency: 'NGN',
    itemAmountMinor: '46000000',
    buyerTotalMinor: '46350000',
    sentAt: '2026-11-16T09:00:00.000Z',
    createdAt: '2026-11-16T08:40:00.000Z',
    updatedAt: '2026-11-18T13:24:00.000Z',
  },
  {
    id: TRADE_IDS.buyerSettled,
    tradeCode: 'KMT-87904-NG',
    status: 'SETTLED',
    statusRevision: 9,
    yourRole: 'BUYER',
    initiatorRole: 'SELLER',
    awaiting: null,
    attention: null,
    counterparty: SELLER_CARD,
    item: { title: 'iPad 9th gen, 64GB', categoryCode: 'ELECTRONICS', categoryName: 'Electronics' },
    currency: 'NGN',
    itemAmountMinor: '28500000',
    buyerTotalMinor: '29640000',
    sentAt: '2026-11-02T09:00:00.000Z',
    createdAt: '2026-11-02T08:40:00.000Z',
    updatedAt: '2026-11-09T11:00:00.000Z',
  },
];

const SELLER_TRADES: TradeListItem[] = [
  {
    id: TRADE_IDS.sellerShipped,
    tradeCode: 'KMT-88301-NG',
    status: 'SHIPPED',
    statusRevision: 5,
    yourRole: 'SELLER',
    initiatorRole: 'BUYER',
    awaiting: null,
    attention: null,
    counterparty: BUYER_CARD,
    item: { title: 'Canon EOS 2000D body', categoryCode: 'ELECTRONICS', categoryName: 'Electronics' },
    currency: 'NGN',
    itemAmountMinor: '26000000',
    buyerTotalMinor: '27040000',
    sentAt: '2026-11-12T11:00:00.000Z',
    createdAt: '2026-11-12T10:40:00.000Z',
    updatedAt: '2026-11-16T08:15:00.000Z',
  },
  {
    // A proposal the seller has not answered: the buyer's terms, awaiting the seller's acceptance.
    id: TRADE_IDS.sellerProposal,
    tradeCode: 'KMT-88317-NG',
    status: 'AWAITING_ACCEPTANCE',
    statusRevision: 1,
    yourRole: 'SELLER',
    initiatorRole: 'BUYER',
    awaiting: 'YOU',
    attention: 'RESPOND_TO_PROPOSAL',
    counterparty: BUYER_CARD,
    item: { title: 'Standing desk, oak top', categoryCode: 'FURNITURE', categoryName: 'Furniture' },
    currency: 'NGN',
    itemAmountMinor: '12000000',
    buyerTotalMinor: null,
    sentAt: '2026-11-18T07:45:00.000Z',
    createdAt: '2026-11-18T07:40:00.000Z',
    updatedAt: '2026-11-18T07:45:00.000Z',
  },
  // F-069/F-073 fulfil & payouts: two orders to ship, one in the buyer's inspection and one completed and paid out.
  {
    id: TRADE_IDS.sellerFunded,
    tradeCode: 'KMT-88331-NG',
    status: 'FUNDED',
    statusRevision: 4,
    yourRole: 'SELLER',
    initiatorRole: 'BUYER',
    awaiting: null,
    attention: 'SHIP',
    counterparty: BUYER_CARD,
    item: { title: 'MacBook Air M2', categoryCode: 'ELECTRONICS', categoryName: 'Electronics' },
    currency: 'NGN',
    itemAmountMinor: '98000000',
    buyerTotalMinor: '101920000',
    sentAt: '2026-11-17T09:00:00.000Z',
    createdAt: '2026-11-17T08:40:00.000Z',
    updatedAt: '2026-11-19T07:30:00.000Z',
  },
  {
    id: TRADE_IDS.sellerFundedTwo,
    tradeCode: 'KMT-88213-NG',
    status: 'FUNDED',
    statusRevision: 4,
    yourRole: 'SELLER',
    initiatorRole: 'BUYER',
    awaiting: null,
    attention: 'SHIP',
    counterparty: { ...BUYER_CARD, publicId: 'KMT-PUB-0003', username: 'bola.o', displayName: 'Bola Okoro' },
    item: { title: 'Ankara print armchair', categoryCode: 'FURNITURE', categoryName: 'Furniture' },
    currency: 'NGN',
    itemAmountMinor: '8950000',
    buyerTotalMinor: '9310000',
    sentAt: '2026-11-17T10:00:00.000Z',
    createdAt: '2026-11-17T09:40:00.000Z',
    updatedAt: '2026-11-18T15:10:00.000Z',
  },
  {
    id: TRADE_IDS.sellerInspection,
    tradeCode: 'KMT-88190-NG',
    status: 'INSPECTION',
    statusRevision: 6,
    yourRole: 'SELLER',
    initiatorRole: 'BUYER',
    awaiting: null,
    attention: null,
    counterparty: { ...BUYER_CARD, publicId: 'KMT-PUB-0004', username: 'tunde.a', displayName: 'Tunde Ade' },
    item: { title: 'Galaxy Buds Pro', categoryCode: 'ELECTRONICS', categoryName: 'Electronics' },
    currency: 'NGN',
    itemAmountMinor: '8950000',
    buyerTotalMinor: '9310000',
    sentAt: '2026-11-13T09:00:00.000Z',
    createdAt: '2026-11-13T08:40:00.000Z',
    updatedAt: '2026-11-18T10:20:00.000Z',
  },
  {
    id: TRADE_IDS.sellerSettled,
    tradeCode: 'KMT-88102-NG',
    status: 'SETTLED',
    statusRevision: 9,
    yourRole: 'SELLER',
    initiatorRole: 'BUYER',
    awaiting: null,
    attention: null,
    counterparty: BUYER_CARD,
    item: { title: 'iPhone 13 Pro, 256GB', categoryCode: 'ELECTRONICS', categoryName: 'Electronics' },
    currency: 'NGN',
    itemAmountMinor: '45200000',
    buyerTotalMinor: '47008000',
    sentAt: '2026-11-05T09:00:00.000Z',
    createdAt: '2026-11-05T08:40:00.000Z',
    updatedAt: '2026-11-12T14:14:00.000Z',
  },
];

/** The trade list a persona sees in each scenario. Staff have no consumer trades, so they get none. */
export function tradesFor(persona: PersonaId, scenario: ScenarioId): TradeListItem[] {
  if (scenario === 'no-trades') return [];
  if (persona === 'buyer') return BUYER_TRADES;
  if (persona === 'seller' || persona === 'merchant') return SELLER_TRADES;
  return [];
}

/** What `GET /me/viewer` answers. A fixed copy of the persona's facts, so the route and the seal agree. */
export function viewerFactsFor(persona: PersonaId): ViewerFacts {
  return { ...PERSONAS[persona].facts };
}

// --- one trade ------------------------------------------------------------------------------------

/** What a single-trade view adds to the list row: the facts the list does not carry. */
interface TradeFacts {
  acceptedAt: string | null;
  proofMediaCount: number;
  itemSpec: Record<string, string>;
}

const TRADE_FACTS: Readonly<Record<string, TradeFacts>> = {
  [TRADE_IDS.buyerFunded]: {
    acceptedAt: '2026-11-14T09:40:00.000Z',
    proofMediaCount: 2,
    itemSpec: { brand: 'Samsung', model: 'Galaxy A34', storage: '128GB', colour: 'Awesome Lime' },
  },
  [TRADE_IDS.buyerPending]: {
    acceptedAt: '2026-11-17T16:40:00.000Z',
    proofMediaCount: 0,
    itemSpec: { model: 'Mesh office chair', colour: 'Graphite' },
  },
  [TRADE_IDS.buyerInspection]: {
    acceptedAt: '2026-11-13T09:10:00.000Z',
    proofMediaCount: 2,
    itemSpec: { brand: 'Hisense', model: '1.5HP split AC', colour: 'White' },
  },
  [TRADE_IDS.buyerDisputed]: {
    acceptedAt: '2026-11-10T10:30:00.000Z',
    proofMediaCount: 2,
    itemSpec: { brand: 'JBL', model: 'Flip 6', colour: 'Black' },
  },
  [TRADE_IDS.sellerShipped]: {
    acceptedAt: '2026-11-12T11:40:00.000Z',
    proofMediaCount: 2,
    itemSpec: { brand: 'Canon', model: 'EOS 2000D body' },
  },
  [TRADE_IDS.sellerProposal]: {
    acceptedAt: null,
    proofMediaCount: 0,
    itemSpec: { model: 'Standing desk', top: 'Oak' },
  },
  // F-069/F-073 deliver & inspect
  [TRADE_IDS.buyerShipped]: {
    acceptedAt: '2026-11-16T09:41:00.000Z',
    proofMediaCount: 2,
    itemSpec: { brand: 'Apple', model: 'iPhone 13 Pro', storage: '256GB', colour: 'Sierra Blue' },
  },
  [TRADE_IDS.buyerSettled]: {
    acceptedAt: '2026-11-02T09:30:00.000Z',
    proofMediaCount: 2,
    itemSpec: { brand: 'Apple', model: 'iPad 9th gen', storage: '64GB' },
  },
  // F-069/F-073 fulfil & payouts
  [TRADE_IDS.sellerFunded]: {
    acceptedAt: '2026-11-17T09:40:00.000Z',
    proofMediaCount: 3,
    itemSpec: { brand: 'Apple', model: 'MacBook Air M2', storage: '256GB' },
  },
  [TRADE_IDS.sellerFundedTwo]: {
    acceptedAt: '2026-11-17T10:30:00.000Z',
    proofMediaCount: 2,
    itemSpec: { model: 'Ankara print armchair', colour: 'Orange' },
  },
  [TRADE_IDS.sellerInspection]: {
    acceptedAt: '2026-11-13T09:40:00.000Z',
    proofMediaCount: 2,
    itemSpec: { brand: 'Samsung', model: 'Galaxy Buds Pro' },
  },
  [TRADE_IDS.sellerSettled]: {
    acceptedAt: '2026-11-05T09:40:00.000Z',
    proofMediaCount: 3,
    itemSpec: { brand: 'Apple', model: 'iPhone 13 Pro', storage: '256GB' },
  },
};

const BUYER_ADDRESS = { street: '12 Admiralty Way, Lekki Phase 1', landmark: 'Opposite the filling station' };
const SELLER_ADDRESS = { street: '4 Allen Avenue, Ikeja', landmark: 'Next to the pharmacy' };

/** The buyer total less the item price is the buyer's protection fee; commission is five per cent of the item. */
function feesFor(itemAmountMinor: string, buyerTotalMinor: string): NonNullable<TradeView['fees']> {
  const item = BigInt(itemAmountMinor);
  const total = BigInt(buyerTotalMinor);
  const commission = (item * 5n) / 100n;
  return {
    scheduleVersion: 'fees-2026-10',
    itemAmountMinor,
    buyerProtectionFeeMinor: (total - item).toString(),
    buyerTotalMinor,
    commissionMinor: commission.toString(),
    sellerProceedsMinor: (item - commission).toString(),
  };
}

function tradeViewOf(item: TradeListItem): TradeView {
  const facts = TRADE_FACTS[item.id];
  if (facts === undefined) throw new Error(`No single-trade facts for ${item.tradeCode}`);
  const amount = item.itemAmountMinor;
  const total = item.buyerTotalMinor;
  const standardVersionId =
    item.item.categoryCode === null ? null : (STANDARD_VERSION_IDS[item.item.categoryCode] ?? null);
  return {
    id: item.id,
    tradeCode: item.tradeCode,
    shareUrl: `https://app.komtru.com/trades/${item.tradeCode}`,
    categoryCode: item.item.categoryCode,
    categoryName: item.item.categoryName,
    standardVersion: standardVersionId === null ? null : 3,
    standardVersionId,
    counterparty: item.counterparty,
    status: item.status,
    statusRevision: item.statusRevision,
    initiatorRole: item.initiatorRole,
    yourRole: item.yourRole,
    awaiting: item.awaiting,
    terms:
      amount === null
        ? null
        : {
            versionId: TERMS_VERSION_ID,
            versionNumber: 1,
            proposedByRole: item.initiatorRole,
            itemAmountMinor: amount,
            currency: item.currency,
            itemSpec: facts.itemSpec,
            inspectionWindowHours: 72,
            deliveryGraceHours: 24,
            deliveryAddress: BUYER_ADDRESS,
            shipsFromAddress: SELLER_ADDRESS,
            createdAt: item.createdAt,
          },
    // The fees freeze on acceptance, so a proposal nobody has accepted has none.
    fees: amount === null || total === null ? null : feesFor(amount, total),
    proofMediaCount: facts.proofMediaCount,
    sentAt: item.sentAt,
    acceptedAt: facts.acceptedAt,
    createdAt: item.createdAt,
  };
}

/** `GET /trades/:id` for this persona in this scenario, or `null` when the trade is not theirs to see. */
export function tradeFor(persona: PersonaId, scenario: ScenarioId, id: string): TradeView | null {
  const item = tradesFor(persona, scenario).find((candidate) => candidate.id === id);
  return item === undefined ? null : tradeViewOf(item);
}

// --- disputes -------------------------------------------------------------------------------------

const BUYER_USER_ID = PERSONAS.buyer.userId;
const SELLER_USER_ID = PERSONAS.seller.userId;

/**
 * The case on `buyerDisputed`: opened by the buyer, in evidence collection, with mediation already lapsed. The
 * window is 72 hours from the pinned clock, so the countdown reads the same on every run.
 */
const DISPUTE: Dispute = {
  id: DISPUTE_ID,
  disputeNumber: 88244,
  code: 'DIS-088244',
  tradeId: TRADE_IDS.buyerDisputed,
  orderId: null,
  status: 'OPEN_EVIDENCE_COLLECTION',
  category: 'ITEM_NOT_AS_DESCRIBED',
  creationPath: 'DIRECT_FILING',
  openedReason: 'The speaker arrived with a cracked grille and the charger is not the one listed.',
  openedByUserId: BUYER_USER_ID,
  buyerUserId: BUYER_USER_ID,
  sellerUserId: SELLER_USER_ID,
  totalEscrowMinor: '10290000',
  window: {
    kind: 'EVIDENCE',
    deadlineAt: '2026-11-22T09:00:00.000Z',
    remaining: { hours: 72, minutes: 0, expired: false },
  },
  mediationDeadlineAt: '2026-11-17T09:00:00.000Z',
  evidenceDeadlineAt: '2026-11-22T09:00:00.000Z',
  evidenceReopenedAt: null,
  decidedAt: null,
  appealDeadlineAt: null,
  appealFiledAt: null,
  closedAt: null,
  createdAt: '2026-11-16T10:00:00.000Z',
};

const DISPUTE_EVIDENCE_BY_BUYER: DisputeEvidence = {
  id: '0190b0a0-0000-7000-8000-000000000611',
  disputeId: DISPUTE_ID,
  submittedByUserId: BUYER_USER_ID,
  fileRefId: '0190b0a0-0000-7000-8000-000000000621',
  note: 'Photo of the cracked grille and of the charger label, taken at the hub.',
  submittedAfterDeadline: false,
  submittedAt: '2026-11-17T08:45:00.000Z',
};

const DISPUTE_EVIDENCE_BY_SELLER: DisputeEvidence = {
  id: '0190b0a0-0000-7000-8000-000000000612',
  disputeId: DISPUTE_ID,
  submittedByUserId: SELLER_USER_ID,
  fileRefId: '0190b0a0-0000-7000-8000-000000000622',
  note: 'Packing photo and the waybill for the handover.',
  submittedAfterDeadline: false,
  submittedAt: '2026-11-18T14:20:00.000Z',
};

const DISPUTE_TIMELINE: DisputeTimelineEntry[] = [
  {
    id: 2,
    occurredAt: '2026-11-17T09:00:00.000Z',
    fromStatus: 'MEDIATION',
    toStatus: 'OPEN_EVIDENCE_COLLECTION',
    action: 'MEDIATION_LAPSED',
    actorType: 'SYSTEM',
    actorId: null,
    reason: 'No settlement by the mediation deadline.',
  },
  {
    id: 1,
    occurredAt: '2026-11-16T10:00:00.000Z',
    fromStatus: null,
    toStatus: 'MEDIATION',
    action: 'DISPUTE_OPENED',
    actorType: 'BUYER',
    actorId: BUYER_USER_ID,
    reason: 'The speaker arrived with a cracked grille and the charger is not the one listed.',
  },
];

/** Y1. Both panels are always drawn: an empty one reads as "nothing submitted", not as an accusation. */
const EVIDENCE_COMPARISON: EvidenceComparison = {
  disputeId: DISPUTE_ID,
  tradeId: TRADE_IDS.buyerDisputed,
  seller: {
    role: 'SELLER',
    userId: SELLER_USER_ID,
    fromTrade: [
      {
        id: 'media-dispatch-1',
        fileRefId: '0190b0a0-0000-7000-8000-000000000631',
        event: 'DISPATCH',
        uploadedByUserId: SELLER_USER_ID,
        capturedAt: '2026-11-11T14:00:00.000Z',
      },
    ],
    fromDispute: [DISPUTE_EVIDENCE_BY_SELLER],
  },
  buyer: {
    role: 'BUYER',
    userId: BUYER_USER_ID,
    fromTrade: [
      {
        id: 'media-inspection-1',
        fileRefId: '0190b0a0-0000-7000-8000-000000000632',
        event: 'INSPECTION',
        uploadedByUserId: BUYER_USER_ID,
        capturedAt: '2026-11-14T10:20:00.000Z',
      },
      {
        id: 'media-issue-1',
        fileRefId: '0190b0a0-0000-7000-8000-000000000633',
        event: 'ISSUE',
        uploadedByUserId: BUYER_USER_ID,
        capturedAt: '2026-11-16T09:30:00.000Z',
      },
    ],
    fromDispute: [DISPUTE_EVIDENCE_BY_BUYER],
  },
  custody: [
    {
      id: 'custody-1',
      fileRefId: '0190b0a0-0000-7000-8000-000000000634',
      hubName: 'Park Hub, Yaba',
      takenAt: '2026-11-12T09:15:00.000Z',
    },
  ],
  timeline: [
    { at: '2026-11-11T14:00:00.000Z', kind: 'DISPATCHED', detail: null },
    { at: '2026-11-12T09:15:00.000Z', kind: 'CUSTODY_TAKEN', detail: 'Park Hub, Yaba' },
    { at: '2026-11-14T10:20:00.000Z', kind: 'INSPECTION_STARTED', detail: null },
    { at: '2026-11-16T09:30:00.000Z', kind: 'ISSUE_REPORTED', detail: 'Item not as described' },
  ],
  // Mediation lapsed on the 17th, so the comparison has no mediation clock to show.
  mediation: null,
};

/** Whether this persona may see the case: a party to its trade, which is the only way a trade's case is reached. */
function disputeVisible(persona: PersonaId, scenario: ScenarioId, dispute: Dispute): boolean {
  return tradesFor(persona, scenario).some((item) => item.id === dispute.tradeId);
}

function disputeDetailOf(persona: PersonaId): DisputeDetail {
  return {
    ...DISPUTE,
    yourRole: PERSONAS[persona].userId === DISPUTE.buyerUserId ? 'BUYER' : 'SELLER',
    decisions: [],
    proposals: [],
  };
}

/** `GET /disputes` for this persona: the cases on their trades. One page holds them all. */
export function disputesFor(persona: PersonaId, scenario: ScenarioId): Dispute[] {
  return disputeVisible(persona, scenario, DISPUTE) ? [DISPUTE] : [];
}

/** `GET /disputes/:id`, or `null` when the case is not theirs. */
export function disputeDetailFor(persona: PersonaId, scenario: ScenarioId, id: string): DisputeDetail | null {
  return id === DISPUTE_ID && disputeVisible(persona, scenario, DISPUTE) ? disputeDetailOf(persona) : null;
}

/** `GET /trades/:id/dispute`: the case on this trade, or `null` when the trade has none. */
export function tradeDisputeFor(persona: PersonaId, scenario: ScenarioId, tradeId: string): Dispute | null {
  return disputesFor(persona, scenario).find((dispute) => dispute.tradeId === tradeId) ?? null;
}

/** `GET /disputes/:id/timeline`, newest first. */
export function disputeTimelineFor(
  persona: PersonaId,
  scenario: ScenarioId,
  id: string,
): DisputeTimelineEntry[] | null {
  return id === DISPUTE_ID && disputeVisible(persona, scenario, DISPUTE) ? DISPUTE_TIMELINE : null;
}

/** `GET /disputes/:id/evidence`: what both parties submitted. */
export function disputeEvidenceFor(
  persona: PersonaId,
  scenario: ScenarioId,
  id: string,
): DisputeEvidence[] | null {
  return id === DISPUTE_ID && disputeVisible(persona, scenario, DISPUTE)
    ? [DISPUTE_EVIDENCE_BY_SELLER, DISPUTE_EVIDENCE_BY_BUYER]
    : null;
}

/** `GET /disputes/:id/evidence-comparison` (Y1). */
export function evidenceComparisonFor(
  persona: PersonaId,
  scenario: ScenarioId,
  id: string,
): EvidenceComparison | null {
  return id === DISPUTE_ID && disputeVisible(persona, scenario, DISPUTE) ? EVIDENCE_COMPARISON : null;
}

// --- me -------------------------------------------------------------------------------------------

interface MeFacts {
  publicId: string;
  username: string;
  verificationLevel: string;
  since: string;
  email: string;
  phone: string;
  abilities: { buy: boolean; sell: boolean; withdraw: boolean };
}

/** Consumer accounts only. Staff have no `/me`, and the stand-in answers them 403 before a fixture is read. */
const ME_FACTS: Partial<Record<PersonaId, MeFacts>> = {
  buyer: {
    publicId: 'KMT-PUB-0001',
    username: 'ada.okafor',
    verificationLevel: 'CONTACT_VERIFIED',
    since: '2026-07-30T10:00:00.000Z',
    email: 'a***@example.com',
    phone: '+234 *** *** 0142',
    abilities: { buy: true, sell: false, withdraw: false },
  },
  seller: {
    publicId: 'KMT-PUB-0002',
    username: 'tunde.bello',
    verificationLevel: 'IDENTITY_VERIFIED',
    since: '2026-06-12T08:30:00.000Z',
    email: 't***@example.com',
    phone: '+234 *** *** 0187',
    abilities: { buy: true, sell: true, withdraw: true },
  },
  merchant: {
    publicId: 'KMT-PUB-0003',
    username: 'ngozi.eze',
    verificationLevel: 'BUSINESS_VERIFIED',
    since: '2026-05-04T11:15:00.000Z',
    email: 'n***@example.com',
    phone: '+234 *** *** 0199',
    // A certified merchant's account is sell-only (design §6.3).
    abilities: { buy: false, sell: true, withdraw: true },
  },
};

/** `GET /me` for this persona in this scenario. The close screens read `canClose` and `openTrades`, so both follow the trades. */
export function meFor(persona: PersonaId, scenario: ScenarioId): Me {
  const facts = ME_FACTS[persona];
  if (facts === undefined) throw new Error(`${persona} has no consumer account to read`);
  const openTrades = tradesFor(persona, scenario).length > 0;
  return {
    id: PERSONAS[persona].userId,
    publicId: facts.publicId,
    username: facts.username,
    verificationLevel: facts.verificationLevel,
    contacts: {
      email: { present: true, masked: facts.email, verified: true },
      phone: { present: true, masked: facts.phone, verified: true },
    },
    account: {
      status: 'ACTIVE',
      since: facts.since,
      abilities: {
        login: true,
        browse: true,
        buy: facts.abilities.buy,
        sell: facts.abilities.sell,
        withdraw: facts.abilities.withdraw,
      },
      openTrades,
      canClose: !openTrades,
      supportReference: `SUP-${facts.publicId.slice(-4)}-0001`,
      noticeKey: null,
    },
  };
}

// --- merchant application -------------------------------------------------------------------------

/** The application state each scenario draws. A certified merchant with no scenario named is approved. */
const APPLICATION_STATUS_BY_SCENARIO: Partial<Record<ScenarioId, MerchantApplicationStatus>> = {
  'application-draft': 'DRAFT',
  'application-in-review': 'IN_REVIEW',
  'application-changes-requested': 'CHANGES_REQUESTED',
  'application-rejected': 'REJECTED',
  'application-approved': 'APPROVED',
};

const DOCUMENT_FILE_IDS = {
  CAC_CERTIFICATE: '0190b0a0-0000-7000-8000-000000000711',
  STATUS_REPORT: '0190b0a0-0000-7000-8000-000000000712',
  DIRECTOR_ID: '0190b0a0-0000-7000-8000-000000000713',
} as const;

const CAC_DOCUMENT: MerchantApplication['documents'][number] = {
  docType: 'CAC_CERTIFICATE',
  label: 'CAC certificate',
  fileId: DOCUMENT_FILE_IDS.CAC_CERTIFICATE,
};

const SUBMITTED_DOCUMENTS: MerchantApplication['documents'] = [
  CAC_DOCUMENT,
  { docType: 'STATUS_REPORT', label: 'CAC status report', fileId: DOCUMENT_FILE_IDS.STATUS_REPORT },
  { docType: 'DIRECTOR_ID', label: 'Director ID', fileId: DOCUMENT_FILE_IDS.DIRECTOR_ID },
];

const FORM: MerchantApplication['form'] = {
  businessName: 'Okafor Textiles Ltd',
  businessType: 'REGISTERED_BUSINESS',
  addressLine: '14 Adetokunbo Ademola Street, Victoria Island',
  stateId: STATE_ID,
  cityId: CITY_IDS.lekki,
  categories: ['FASHION'],
  cacRcNumber: 'RC1234567',
  payoutAccountId: PAYOUT_ACCOUNT_ID,
};

/** One application, in one state. The fields the state does not draw are left out, as the API leaves them. */
function applicationIn(status: MerchantApplicationStatus): MerchantApplication {
  const base: MerchantApplication = {
    id: APPLICATION_ID,
    status,
    form: FORM,
    documents: SUBMITTED_DOCUMENTS,
    changesRequested: [],
    lastDecision: null,
    canEdit: false,
    submissionCount: 1,
    submittedAt: '2026-11-16T12:00:00.000Z',
    decidedAt: null,
    createdAt: '2026-11-14T09:00:00.000Z',
  };
  switch (status) {
    case 'DRAFT':
      // Started, not sent: the CAC certificate is in, the other two are not.
      return {
        ...base,
        documents: [CAC_DOCUMENT],
        canEdit: true,
        submissionCount: 0,
        submittedAt: null,
      };
    case 'SUBMITTED':
    case 'IN_REVIEW':
      return base;
    case 'CHANGES_REQUESTED':
      return {
        ...base,
        canEdit: true,
        changesRequested: [
          {
            kind: 'DOCUMENT',
            key: 'STATUS_REPORT',
            note: 'The status report is dated before the last annual return',
          },
          {
            kind: 'FIELD',
            key: 'cacRcNumber',
            note: 'The RC number on the form does not match the certificate',
          },
        ],
        lastDecision: {
          outcome: 'CHANGES_REQUESTED',
          reason: 'Two items need correcting before review.',
          decidedAt: '2026-11-18T09:00:00.000Z',
        },
        decidedAt: '2026-11-18T09:00:00.000Z',
      };
    case 'REJECTED':
      return {
        ...base,
        submissionCount: 2,
        lastDecision: {
          outcome: 'REJECTED',
          reason: 'The business name on the certificate does not match the application.',
          decidedAt: '2026-11-18T10:00:00.000Z',
        },
        decidedAt: '2026-11-18T10:00:00.000Z',
      };
    case 'APPROVED':
      return {
        ...base,
        lastDecision: {
          outcome: 'APPROVED',
          reason: 'Documents and the registry record match.',
          decidedAt: '2026-11-18T10:00:00.000Z',
        },
        decidedAt: '2026-11-18T10:00:00.000Z',
      };
  }
}

/** `GET /merchant/applications/me`: the person's application in their scenario, or `null` before they started one. */
export function merchantApplicationFor(persona: PersonaId, scenario: ScenarioId): MerchantApplication | null {
  const status =
    APPLICATION_STATUS_BY_SCENARIO[scenario] ??
    (PERSONAS[persona].facts.certifiedMerchant ? 'APPROVED' : null);
  return status === null ? null : applicationIn(status);
}

// --- payment, inspection and the trade standard ---------------------------------------------------

/**
 * `GET /trades/:id/payment/status`. A trade still waiting for funding has no attempt yet (V1 draws the
 * payment-method choice); a funded trade has the attempt that funded it, confirmed.
 */
export function paymentStatusFor(
  persona: PersonaId,
  scenario: ScenarioId,
  tradeId: string,
): PaymentStatus | null {
  const item = tradesFor(persona, scenario).find((candidate) => candidate.id === tradeId);
  if (item === undefined) return null;
  if (!(FUNDED_TRADE_STATUSES as readonly string[]).includes(item.status)) {
    return { tradeId, tradeCode: item.tradeCode, displayState: 'NONE', attempt: null };
  }
  const attemptId = PAYMENT_ATTEMPT_IDS[tradeId];
  const facts = TRADE_FACTS[tradeId];
  if (
    attemptId === undefined ||
    facts === undefined ||
    item.itemAmountMinor === null ||
    item.buyerTotalMinor === null
  ) {
    throw new Error(`No payment attempt fixture for ${item.tradeCode}`);
  }
  return {
    tradeId,
    tradeCode: item.tradeCode,
    displayState: 'CONFIRMED',
    attempt: {
      id: attemptId,
      reference: `fund-${attemptId}`,
      status: 'SUCCEEDED',
      displayState: 'CONFIRMED',
      currency: item.currency,
      amountMinor: item.buyerTotalMinor,
      itemAmountMinor: item.itemAmountMinor,
      buyerProtectionFeeMinor: (BigInt(item.buyerTotalMinor) - BigInt(item.itemAmountMinor)).toString(),
      initiatedAt: facts.acceptedAt ?? item.createdAt,
      confirmedAt: facts.acceptedAt ?? item.createdAt,
    },
  };
}

/** `GET /trades/:id/inspection`. The window runs only while the trade is in inspection; otherwise it is closed. */
export function inspectionFor(
  persona: PersonaId,
  scenario: ScenarioId,
  tradeId: string,
): TradeInspection | null {
  const item = tradesFor(persona, scenario).find((candidate) => candidate.id === tradeId);
  if (item === undefined) return null;
  const inInspection = item.status === 'INSPECTION';
  return {
    status: item.status,
    yourRole: item.yourRole,
    window: {
      hours: 72,
      startedAt: inInspection ? '2026-11-18T10:20:00.000Z' : null,
      deadlineAt: inInspection ? '2026-11-21T10:20:00.000Z' : null,
      extended: false,
      autoReleasePaused: false,
    },
    extensionRequest: null,
    canRequestMoreTime: inInspection && item.yourRole === 'BUYER',
    canRespondToRequest: false,
    sellerProof: {
      media: [
        { fileId: '0190b0a0-0000-7000-8000-000000000821', attachedAt: '2026-11-14T07:50:00.000Z' },
        { fileId: '0190b0a0-0000-7000-8000-000000000822', attachedAt: '2026-11-14T07:52:00.000Z' },
      ],
    },
    deliveryEvidence: {
      signals: [{ source: 'COURIER', reportedAt: '2026-11-14T13:40:00.000Z' }],
      selfArranged: {
        waybillNumber: 'KMP-40817',
        shippedAt: '2026-11-14T07:30:00.000Z',
        vehiclePlate: 'LSD-214-KM',
      },
    },
  };
}

/** The shape `getInspection` answers, as far as a fixture sets it. The contract is checked at startup against the endpoint. */
export interface TradeInspection {
  status: string;
  yourRole: 'BUYER' | 'SELLER';
  window: {
    hours: number;
    startedAt: string | null;
    deadlineAt: string | null;
    extended: boolean;
    autoReleasePaused: boolean;
  };
  extensionRequest: null;
  canRequestMoreTime: boolean;
  canRespondToRequest: boolean;
  sellerProof: { media: { fileId: string; attachedAt: string }[] };
  deliveryEvidence: {
    signals: { source: string; reportedAt: string }[];
    selfArranged: { waybillNumber: string; shippedAt: string; vehiclePlate: string } | null;
  };
}

/** The Trade Standard each category pins: what its item spec asks for and how much proof it needs. */
const STANDARDS: readonly {
  categoryCode: string;
  categoryName: string;
  imeiVerification: boolean;
  deliveryDeadlineDays: number;
  itemSpecFields: { key: string; label: string; required: boolean }[];
}[] = [
  {
    categoryCode: 'PHONES',
    categoryName: 'Phones',
    imeiVerification: true,
    deliveryDeadlineDays: 7,
    itemSpecFields: [
      { key: 'brand', label: 'Brand', required: true },
      { key: 'model', label: 'Model', required: true },
      { key: 'storage', label: 'Storage', required: true },
    ],
  },
  {
    categoryCode: 'FURNITURE',
    categoryName: 'Furniture',
    imeiVerification: false,
    deliveryDeadlineDays: 14,
    itemSpecFields: [
      { key: 'model', label: 'Model', required: true },
      { key: 'colour', label: 'Colour', required: false },
    ],
  },
  {
    categoryCode: 'APPLIANCES',
    categoryName: 'Appliances',
    imeiVerification: false,
    deliveryDeadlineDays: 14,
    itemSpecFields: [
      { key: 'brand', label: 'Brand', required: true },
      { key: 'model', label: 'Model', required: true },
    ],
  },
  {
    categoryCode: 'ELECTRONICS',
    categoryName: 'Electronics',
    imeiVerification: false,
    deliveryDeadlineDays: 7,
    itemSpecFields: [
      { key: 'brand', label: 'Brand', required: true },
      { key: 'model', label: 'Model', required: true },
    ],
  },
];

/** `GET /config/trade-standards/versions/:id`: one version, which a trade froze when it was proposed. */
export function tradeStandardFor(versionId: string): TradeStandard | null {
  const category = Object.keys(STANDARD_VERSION_IDS).find((code) => STANDARD_VERSION_IDS[code] === versionId);
  const standard = STANDARDS.find((candidate) => candidate.categoryCode === category);
  if (standard === undefined) return null;
  return {
    versionId,
    categoryCode: standard.categoryCode,
    categoryName: standard.categoryName,
    versionNumber: 3,
    createdAt: '2026-10-01T09:00:00.000Z',
    inspectionWindowHours: 72,
    itemSpecFields: standard.itemSpecFields,
    proofMedia: { minPhotos: 2, requireVideo: false },
    imeiVerification: standard.imeiVerification,
    deliveryDeadlineDays: standard.deliveryDeadlineDays,
  };
}

/** Every version the fixtures name, for the startup check and for tests. */
export const STANDARD_VERSION_IDS_LIST: readonly string[] = Object.values(STANDARD_VERSION_IDS);

// --- the account: verification, payout accounts and addresses -------------------------------------

/** `GET /verification/status`, which the account's verification tab reads. Levels follow `GET /me`. */
export function verificationStatusFor(persona: PersonaId): VerificationStatus {
  const levels: Record<
    Exclude<PersonaId, 'staff'>,
    { level: string; levelNumber: number; identifier: boolean; liveness: boolean; business: boolean }
  > = {
    buyer: { level: 'CONTACT_VERIFIED', levelNumber: 1, identifier: false, liveness: false, business: false },
    seller: { level: 'IDENTITY_VERIFIED', levelNumber: 2, identifier: true, liveness: true, business: false },
    merchant: {
      level: 'BUSINESS_VERIFIED',
      levelNumber: 3,
      identifier: true,
      liveness: true,
      business: true,
    },
  };
  if (persona === 'staff') throw new Error('Staff have no consumer verification to read');
  const row = levels[persona];
  return {
    level: row.level,
    levelNumber: row.levelNumber,
    levelAttainedAt: row.levelNumber === 1 ? null : '2026-07-02T10:00:00.000Z',
    requirements: {
      identifier: row.identifier,
      liveness: row.liveness,
      business: row.business,
      businessBankAccount: row.business,
    },
    inFlight: [],
    rejections: [],
  };
}

/** `GET /me/payout-accounts`: a verified account is the one automatic payouts go to. A buyer has none. */
export function payoutAccountsFor(persona: PersonaId): PayoutAccount[] {
  if (persona === 'seller' || persona === 'merchant') {
    return [
      {
        id: PAYOUT_ACCOUNT_ID,
        bankCode: '058',
        bankName: 'GTBank',
        accountNumberMasked: '******5567',
        accountName: persona === 'merchant' ? 'OKAFOR TEXTILES LTD' : 'TUNDE BELLO',
        status: 'VERIFIED',
        isDefault: true,
        failureReason: null,
        createdAt: '2026-07-02T10:00:00.000Z',
        verifiedAt: '2026-07-02T10:01:00.000Z',
      },
    ];
  }
  return [];
}

/** `GET /me/addresses`: the saved address each consumer ships to or from. */
export function addressesFor(persona: PersonaId): Address[] {
  if (persona === 'buyer') {
    return [
      {
        id: ADDRESS_IDS.buyer,
        label: 'Home',
        recipientName: 'Ada Okafor',
        recipientPhone: '+234 *** *** 0142',
        streetLine: '12 Admiralty Way, Lekki Phase 1',
        landmark: 'Opposite the filling station',
        stateId: STATE_ID,
        stateName: 'Lagos',
        cityId: CITY_IDS.lekki,
        cityName: 'Lekki',
        cityActive: true,
        isDefault: true,
        archivedAt: null,
        createdAt: '2026-07-30T10:00:00.000Z',
        updatedAt: '2026-07-30T10:00:00.000Z',
      },
    ];
  }
  if (persona === 'seller' || persona === 'merchant') {
    return [
      {
        id: ADDRESS_IDS.seller,
        label: 'Shop',
        recipientName: persona === 'merchant' ? 'Ngozi Eze' : 'Tunde Bello',
        recipientPhone: '+234 *** *** 0187',
        streetLine: '4 Allen Avenue, Ikeja',
        landmark: 'Next to the pharmacy',
        stateId: STATE_ID,
        stateName: 'Lagos',
        cityId: CITY_IDS.ikeja,
        cityName: 'Ikeja',
        cityActive: true,
        isDefault: true,
        archivedAt: null,
        createdAt: '2026-06-12T08:30:00.000Z',
        updatedAt: '2026-06-12T08:30:00.000Z',
      },
    ];
  }
  return [];
}

// --- F-069/F-073 deliver & inspect: the reads behind the trade workspace and the evidence screens --------------------

const DEADLINE_ID = '0190b0a0-0000-7000-8000-000000000852';

// --- F-069/F-073 fulfil & payouts -----------------------------------------------------------------
/** `GET /trades/:id/ship-options`: Park is not offered in the seller's city; the seller's own arrangement is. */
export function shipOptionsFor(
  persona: PersonaId,
  scenario: ScenarioId,
  tradeId: string,
): ShipOptions | null {
  const item = tradesFor(persona, scenario).find((candidate) => candidate.id === tradeId);
  if (item === undefined || item.status !== 'FUNDED' || item.yourRole !== 'SELLER') return null;
  return {
    tradeId,
    tradeCode: item.tradeCode,
    options: [
      {
        kind: 'PARK',
        label: 'Park Hub Transit',
        available: false,
        reason: { code: 'PARK_NOT_AVAILABLE_IN_CITY', message: 'Park isn’t available in Ikeja yet' },
      },
      {
        kind: 'SELF_ARRANGED',
        label: 'Arrange my own shipping',
        available: true,
        requiredFields: ['waybillNumber', 'receiptFileId', 'driverPhone', 'vehiclePlate'],
      },
    ],
  };
}

/**
 * `GET /trades/:id/delivery-deadline`: the seller's time to ship a funded trade (the fulfil screens) and the
 * buyer's delivery window on a shipped one (the deliver screens), from the pinned clock; none after delivery.
 */
export function deliveryDeadlineFor(
  persona: PersonaId,
  scenario: ScenarioId,
  tradeId: string,
): {
  deadline: { id: string; status: string; dueAt: string; extensionCount: number } | null;
  extensionRequest: null;
} | null {
  const item = tradesFor(persona, scenario).find((candidate) => candidate.id === tradeId);
  if (item === undefined) return null;
  return {
    deadline:
      item.status === 'FUNDED'
        ? {
            id: '0190b0a0-0000-7000-8000-000000000851',
            status: 'PENDING',
            dueAt: '2026-11-21T09:00:00.000Z',
            extensionCount: 0,
          }
        : item.status === 'SHIPPED'
          ? { id: DEADLINE_ID, status: 'PENDING', dueAt: '2026-11-20T18:00:00.000Z', extensionCount: 0 }
          : null,
    extensionRequest: null,
  };
}

/** The media either side added under each event of a trade: the seller's dispatch photos and the buyer's inspection photos. */
export function tradeEvidenceFor(
  persona: PersonaId,
  scenario: ScenarioId,
  tradeId: string,
  event: string | null,
):
  | { id: string; fileId: string; event: string; attachedByRole: 'BUYER' | 'SELLER'; attachedAt: string }[]
  | null {
  const item = tradesFor(persona, scenario).find((candidate) => candidate.id === tradeId);
  if (item === undefined) return null;
  const all = [
    {
      id: '0190b0a0-0000-7000-8000-000000000871',
      fileId: '0190b0a0-0000-7000-8000-000000000823',
      event: 'DISPATCH',
      attachedByRole: 'SELLER' as const,
      attachedAt: '2026-11-14T07:35:00.000Z',
    },
    {
      id: '0190b0a0-0000-7000-8000-000000000872',
      fileId: '0190b0a0-0000-7000-8000-000000000824',
      event: 'DISPATCH',
      attachedByRole: 'SELLER' as const,
      attachedAt: '2026-11-14T07:36:00.000Z',
    },
    {
      id: '0190b0a0-0000-7000-8000-000000000873',
      fileId: '0190b0a0-0000-7000-8000-000000000825',
      event: 'INSPECTION',
      attachedByRole: 'BUYER' as const,
      attachedAt: '2026-11-18T11:10:00.000Z',
    },
  ];
  return event === null ? all : all.filter((entry) => entry.event === event);
}

/**
 * `GET /files/:id`: a signed URL for a file the person may see. The stand-in has no storage, so every file is the
 * same flat tile, as a data URL the browser needs no network for.
 */
export function fileFor(fileId: string): {
  fileId: string;
  url: string;
  expiresAt: string | null;
  contentType: string;
} {
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%232A3455'/><stop offset='1' stop-color='%2317203A'/></linearGradient></defs><rect width='160' height='160' fill='url(%23g)'/></svg>";
  return { fileId, url: `data:image/svg+xml,${svg}`, expiresAt: null, contentType: 'image/svg+xml' };
}

/** `GET /me/payouts/summary`: a seller or merchant has a balance to withdraw; a buyer has nothing and no account. */
export function payoutSummaryFor(persona: PersonaId): PayoutSummary {
  const seller = persona === 'seller' || persona === 'merchant';
  const account = payoutAccountsFor(persona)[0];
  return {
    currency: 'NGN',
    availableMinor: seller ? '120000000' : '0',
    inFlightMinor: '0',
    payoutFeeMinor: '0',
    mode: 'MANUAL',
    held: false,
    defaultAccount:
      account === undefined
        ? null
        : {
            id: account.id,
            bankCode: account.bankCode,
            bankName: account.bankName,
            accountNumberMasked: account.accountNumberMasked,
            accountName: account.accountName,
          },
  };
}

/** `GET /me/payouts`: three paid withdrawals, newest first. A buyer has none. */
export function payoutsFor(persona: PersonaId): Payout[] {
  const summary = payoutSummaryFor(persona);
  if (summary.defaultAccount === null) return [];
  const paid = (n: number, amountMinor: string, at: string): Payout => ({
    id: `0190b0a0-0000-7000-8000-0000000008${String(60 + n)}`,
    reference: `payout-0190b0a0-0000-7000-8000-0000000008${String(60 + n)}`,
    status: 'SUCCEEDED',
    trigger: 'MANUAL',
    currency: 'NGN',
    amountMinor,
    feeMinor: '0',
    transferAmountMinor: amountMinor,
    destination: summary.defaultAccount,
    sourceTradeId: null,
    failureReason: null,
    requestedAt: at,
    dispatchedAt: at,
    completedAt: at,
    failedAt: null,
  });
  return [
    paid(1, '45200000', '2026-11-12T13:41:00.000Z'),
    paid(2, '8950000', '2026-11-08T10:20:00.000Z'),
    paid(3, '21000000', '2026-11-02T09:05:00.000Z'),
  ];
}

/** `GET /trades/:id/activity`: what the platform recorded on the completed sale, newest first. Other trades have none. */
export function tradeActivityFor(
  persona: PersonaId,
  scenario: ScenarioId,
  tradeId: string,
): TradeActivityResponse | null {
  const item = tradesFor(persona, scenario).find((candidate) => candidate.id === tradeId);
  if (item === undefined) return null;
  if (item.status !== 'SETTLED') return { items: [], nextCursor: null };
  const row = (
    n: number,
    kind: TradeActivityResponse['items'][number]['kind'],
    actor: 'YOU' | 'OTHER_PARTY' | 'KOMTRU',
    at: string,
  ) => ({
    id: `S:${String(n)}`,
    occurredAt: at,
    kind,
    actor,
    toStatus: null,
    reason: null,
  });
  return {
    items: [
      row(4, 'SETTLED', 'KOMTRU', '2026-11-12T14:14:00.000Z'),
      row(3, 'DELIVERY_CONFIRMED', 'OTHER_PARTY', '2026-11-12T14:02:00.000Z'),
      row(2, 'SHIPPED', 'YOU', '2026-11-07T09:30:00.000Z'),
      row(1, 'FUNDS_PROTECTED', 'KOMTRU', '2026-11-05T10:05:00.000Z'),
    ],
    nextCursor: null,
  };
}
