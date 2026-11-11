// Reading a buyer's request back off a trade's terms, for the seller's screens and the buyer's review.
import type { TradeView } from '@komtru/api-client';
import { addressLine, itemSub } from '../format';
import { isRequestSpec, type DeliveryMode } from './request';

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

export interface RequestReading {
  mode: DeliveryMode | undefined;
  /** "Courier · 5 Adeola Odeku, Victoria Island" or "Park · Jos Central Park". */
  deliveryLine: string;
  /** The buyer's own words for the item, while the seller has not named it. */
  requestedItem: string | undefined;
  collectionPhone: string | undefined;
  parkName: string | undefined;
  /** The seller's commitments, once made. */
  deliveryPartner: string | undefined;
  deliveryChargeMinor: string | undefined;
  deliveryPromise: string | undefined;
  /** The item's description when nothing waits on the seller; `undefined` while it does. */
  itemDetails: string | undefined;
  open: boolean;
  sellerLocation: string | undefined;
}

export function readRequest(trade: TradeView): RequestReading {
  const terms = trade.terms;
  const spec = record(terms?.itemSpec);
  const mode =
    spec.deliveryMode === 'PARK' ? 'PARK' : spec.deliveryMode === 'COURIER' ? 'COURIER' : undefined;
  const parkName = str(spec.parkName);
  const address = terms?.deliveryAddress ?? null;
  const open = isRequestSpec(spec);
  const deliveryLine =
    mode === 'PARK'
      ? `Park · ${parkName ?? 'the chosen Park'}`
      : mode === 'COURIER'
        ? `Courier · ${addressLine(address)}`
        : addressLine(address);
  const ships = terms?.shipsFromAddress ?? null;
  return {
    mode,
    deliveryLine,
    requestedItem: str(spec.requestedItem),
    collectionPhone: str(spec.contactPhone),
    parkName,
    deliveryPartner: str(spec.deliveryPartner),
    deliveryChargeMinor: str(spec.deliveryChargeMinor),
    deliveryPromise: str(spec.deliveryPromise),
    itemDetails: open ? undefined : (itemSub(spec) ?? 'Confirmed by the seller'),
    open,
    sellerLocation: ships === null ? undefined : addressLine(ships),
  };
}
