// The pure half of Create a Trade (F-018): what a buyer's request holds, what the seller still has to say, and the
// delivery commitments that ride with the item specification. The platform stores one specification record per terms
// version and validates it at creation, so a request that leaves the item to the seller marks every required field the
// buyer cannot know as `SELLER_TO_CONFIRM`; the seller replaces them through the counter call. See the plan.
import type { TradeStandard } from '@komtru/api-client';
import { nairaToKobo } from '@komtru/shared-types';

/** The value of a field only the seller can supply, until they supply it. The screens draw it as "Waiting". */
export const SELLER_TO_CONFIRM = 'Seller to confirm';

/**
 * Park collection needs a hub catalogue and custody, both deferred for MVP (docs/MVP.md). CT-B2P and CT-B8P are built
 * and tested; this is the one switch that exposes them.
 */
export const PARK_DELIVERY_ENABLED = false;
export const parkAvailable = (): boolean => PARK_DELIVERY_ENABLED;

/** The keys that are not the item's own description: the buyer's words and the delivery commitments. */
export const REQUEST_KEYS = [
  'requestedItem',
  'deliveryMode',
  'deliveryPartner',
  'deliveryChargeMinor',
  'deliveryPromise',
  'parkId',
  'parkName',
  'contactPhone',
] as const;

export type DeliveryMode = 'COURIER' | 'PARK';

export interface ParkOption {
  id: string;
  name: string;
  /** "Terminus area · Open today · 8am–7pm". */
  detail: string;
}

const KEYWORDS: Record<string, RegExp> = {
  electronics:
    /\b(iphone|ipad|macbook|airpods?|samsung|galaxy|pixel|tecno|infinix|phone|smartphone|laptop|notebook|tablet|tv|television|monitor|console|playstation|ps[45]|xbox|camera|drone|speaker|headphones?|earbuds?|smart ?watch|router|charger|power ?bank)\b/i,
  fashion:
    /\b(shoes?|sneakers?|trainers?|heels|boots?|bag|handbag|purse|dress|gown|jacket|coat|hoodie|jeans|shirt|suit|sandals|loafers|perfume|handbags?|wallet|belt|sunglasses|nike|adidas|gucci|prada|louis vuitton|rolex|watch)\b/i,
};

/** The category the item words point at, among those the platform offers; `undefined` when none does. */
export function detectCategory(
  title: string,
  standards: readonly Pick<TradeStandard, 'categoryCode'>[],
): string | undefined {
  const words = title.trim();
  if (words === '') return undefined;
  for (const standard of standards) {
    const pattern = KEYWORDS[standard.categoryCode];
    if (pattern?.test(words)) return standard.categoryCode;
  }
  return undefined;
}

type Spec = Record<string, unknown>;
const isWaiting = (value: unknown): boolean => value === SELLER_TO_CONFIRM;

/**
 * Item fields whose key is one of the request's own reserved keys. A category defining one would have the seller's
 * answer overwrite (or be overwritten by) the delivery commitments, so such a standard cannot be used.
 */
export const collidingKeys = (standard: Pick<TradeStandard, 'itemSpecFields'>): string[] =>
  standard.itemSpecFields
    .map((field) => field.key)
    .filter((key) => (REQUEST_KEYS as readonly string[]).includes(key));

function assertNoCollision(keys: readonly string[]): void {
  const hit = keys.filter((key) => (REQUEST_KEYS as readonly string[]).includes(key));
  if (hit.length > 0) throw new Error(`item fields collide with reserved request keys: ${hit.join(', ')}`);
}

/** The specification a buyer's request is created with. */
export function requestSpec(
  standard: Pick<TradeStandard, 'itemSpecFields'>,
  title: string,
  extra: Spec = {},
): Spec {
  assertNoCollision(standard.itemSpecFields.map((field) => field.key));
  const spec: Spec = { requestedItem: title.trim() };
  for (const field of standard.itemSpecFields) {
    if (field.required) spec[field.key] = SELLER_TO_CONFIRM;
  }
  return { ...spec, ...extra };
}

/** The fields the seller still has to say. */
export const waitingKeys = (spec: unknown): string[] =>
  typeof spec === 'object' && spec !== null
    ? Object.entries(spec as Spec)
        .filter(([, value]) => isWaiting(value))
        .map(([key]) => key)
    : [];

/** A request still open for the seller: it holds the buyer's words and waits on at least one field. */
export const isRequestSpec = (spec: unknown): boolean => waitingKeys(spec).length > 0;

/** A trade that began as a buyer's request: it carries the delivery choice the request screens record. */
export const isRequestShaped = (spec: unknown): boolean =>
  typeof spec === 'object' &&
  spec !== null &&
  ((spec as Spec).deliveryMode === 'COURIER' || (spec as Spec).deliveryMode === 'PARK');

export interface SellerAnswer {
  /** The item fields by key. Blank ones are left out; the platform refuses a required one that is missing. */
  fields: Record<string, string>;
  delivery: { mode: DeliveryMode; partner?: string; chargeMinor: string; promise: string };
}

/**
 * The request with the seller's part filled in. The buyer's words go once the item has its own name, and the buyer's
 * delivery choice (mode, Park, phone) is kept.
 */
export function completedSpec(request: Spec, answer: SellerAnswer): Spec {
  assertNoCollision(Object.keys(answer.fields));
  const next: Spec = { ...request };
  for (const key of waitingKeys(request)) delete next[key];
  const named = Object.entries(answer.fields).some(
    ([key, value]) => (key === 'brand' || key === 'model') && value.trim() !== '',
  );
  if (named) delete next.requestedItem;
  for (const [key, value] of Object.entries(answer.fields)) {
    if (value.trim() !== '') next[key] = value.trim();
  }
  next.deliveryMode = answer.delivery.mode;
  if (answer.delivery.partner !== undefined && answer.delivery.partner.trim() !== '') {
    next.deliveryPartner = answer.delivery.partner.trim();
  }
  next.deliveryChargeMinor = answer.delivery.chargeMinor;
  next.deliveryPromise = answer.delivery.promise;
  return next;
}

/**
 * The specification a seller-started trade is created with (F-019). The seller is the authoritative source, so every
 * field is theirs and none waits; the delivery commitments ride with it. Courier is the only live mode (Park is
 * deferred), so it is recorded here and the buyer's address arrives with their acceptance.
 */
export function sellerSpec(
  standard: Pick<TradeStandard, 'itemSpecFields'>,
  title: string,
  fields: Record<string, string>,
  delivery: { partner: string; chargeMinor: string; promise: string },
): Spec {
  assertNoCollision(standard.itemSpecFields.map((field) => field.key));
  assertNoCollision(Object.keys(fields));
  const spec: Spec = { requestedItem: title.trim() };
  for (const [key, value] of Object.entries(fields)) {
    if (value.trim() !== '') spec[key] = value.trim();
  }
  spec.deliveryMode = 'COURIER';
  spec.deliveryPartner = delivery.partner.trim();
  spec.deliveryChargeMinor = delivery.chargeMinor;
  spec.deliveryPromise = delivery.promise;
  return spec;
}

/** A trade the seller started with the delivery commitments made, nothing waiting: the buyer's CT-S6 and CT-S7. */
export const isSellerOffer = (initiator: string, spec: unknown): boolean =>
  initiator === 'SELLER' &&
  isRequestShaped(spec) &&
  typeof (spec as Spec).deliveryChargeMinor === 'string' &&
  waitingKeys(spec).length === 0;

export interface PromiseRange {
  value: string;
  label: string;
  /** The longest the range goes, in days. */
  upTo: number;
}

const RANGES: readonly PromiseRange[] = [
  { value: '1-3', label: '1–3 days', upTo: 3 },
  { value: '5-7', label: '5–7 days', upTo: 7 },
  { value: '7-10', label: '7–10 days', upTo: 10 },
  { value: '10-15', label: '10–15 days', upTo: 15 },
];

/** The promises the category's delivery deadline allows. */
export const allowedPromises = (deadlineDays: number): PromiseRange[] =>
  RANGES.filter((range) => range.upTo <= deadlineDays);

export const promiseLabel = (value: unknown): string | undefined =>
  RANGES.find((range) => range.value === value)?.label;

/** A delivery charge in naira as kobo, or `undefined`. Zero is allowed (free delivery); blank and nonsense are not. */
export const parseCharge = (text: string): bigint | undefined => {
  if (text.trim() === '') return undefined;
  try {
    return nairaToKobo(text);
  } catch {
    return undefined;
  }
};
