import type { TradeListItem } from '@komtru/shared-types';

/** The custody stages of AC8, in the order an order moves through them. The phone groups by them; wider screens filter by them. */
export const STAGES = [
  { id: 'ready', title: 'Ready to ship', statuses: ['FUNDED'] },
  { id: 'transit', title: 'In transit', statuses: ['SHIPPED', 'UNCONFIRMED_DELIVERY'] },
  { id: 'inspection', title: 'Awaiting buyer inspection', statuses: ['INSPECTION'] },
] as const;

export type StageId = (typeof STAGES)[number]['id'];

/** The filter chips of DX-18 and TX-11. `Returns` is not here: nothing in the platform says an order is a return. */
export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'action', label: 'Needs action' },
  { id: 'ready', label: 'Ready to ship' },
  { id: 'transit', label: 'In transit' },
  { id: 'inspection', label: 'Inspecting' },
] as const;

export type FilterId = (typeof FILTERS)[number]['id'];

export interface Order {
  trade: TradeListItem;
  stage: StageId;
}

/** The trades the person sells that are in one of the stages, in the platform's order (newest activity first). */
export function ordersOf(trades: readonly TradeListItem[]): Order[] {
  const orders: Order[] = [];
  for (const trade of trades) {
    if (trade.yourRole !== 'SELLER') continue;
    const stage = STAGES.find((candidate) =>
      (candidate.statuses as readonly string[]).includes(trade.status),
    );
    if (stage !== undefined) orders.push({ trade, stage: stage.id });
  }
  return orders;
}

/** `Needs action` is the platform's own `attention`: whether an order waits on the seller is never decided here. */
export const matches = (order: Order, filter: FilterId): boolean =>
  filter === 'all' ? true : filter === 'action' ? order.trade.attention !== null : order.stage === filter;

export const countFor = (orders: readonly Order[], filter: FilterId): number =>
  orders.filter((order) => matches(order, filter)).length;

export const stageTitle = (stage: StageId): string =>
  STAGES.find((candidate) => candidate.id === stage)?.title ?? '';

/** What happens next on an order, from where it is. */
export function nextStep(trade: Pick<TradeListItem, 'status'>): string {
  switch (trade.status) {
    case 'FUNDED':
      return 'Ship it and add the waybill';
    case 'SHIPPED':
      return 'On its way to the buyer';
    case 'UNCONFIRMED_DELIVERY':
      return 'The buyer confirms it arrived';
    case 'INSPECTION':
      return 'The buyer is inspecting it';
    default:
      return '';
  }
}
