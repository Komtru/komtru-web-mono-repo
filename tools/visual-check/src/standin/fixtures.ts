// The canned platform data. Every value is typed against `@komtru/shared-types` and `startStandin`
// parses the whole set against the real schemas before it serves a byte, so a field the contract renamed
// fails here, at startup, rather than as a quietly blank screen. Dates, ids and amounts are fixed: a
// screenshot is only comparable with another if the data behind it did not move.
import type { TradeListItem, ViewerFacts } from '@komtru/shared-types';

import { PERSONAS, type PersonaId, type ScenarioId } from './personas.ts';

const TRADE_IDS = {
  buyerFunded: '0190b0a0-0000-7000-8000-000000000501',
  buyerPending: '0190b0a0-0000-7000-8000-000000000502',
  sellerShipped: '0190b0a0-0000-7000-8000-000000000511',
  sellerProposal: '0190b0a0-0000-7000-8000-000000000512',
} as const;

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
    id: TRADE_IDS.sellerProposal,
    tradeCode: 'KMT-88317-NG',
    status: 'PENDING_COUNTERPARTY',
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
