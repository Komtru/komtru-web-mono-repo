'use client';

import { Button, Chip, EmptyState, type ChipTone } from '@komtru/ui-kit';
import { useEffect, useRef } from 'react';
import { describeTrade, initialsOf, nairaShort, partyName } from '../format';
import { shipHref, tabHref } from '../workspace-state';
import type { ViewportTier } from '../shipping/viewport';
import { FILTERS, countFor, matches, nextStep, stageTitle, type FilterId, type Order } from './model';

const buyerOf = (order: Order): string | undefined =>
  order.trade.counterparty === null ? undefined : partyName(order.trade.counterparty);
const itemOf = (order: Order): string => order.trade.item.title ?? order.trade.item.categoryName ?? 'Trade';
const amountOf = (order: Order): string =>
  order.trade.itemAmountMinor === null ? '—' : nairaShort(order.trade.itemAmountMinor);
const hrefOf = (order: Order): string =>
  order.stage === 'ready' ? shipHref(order.trade.id) : tabHref(order.trade.id, 'overview');
const actionOf = (order: Order): string => (order.stage === 'ready' ? 'Dispatch' : 'Open');
const toneOf = (order: Order): ChipTone => describeTrade(order.trade).tone;

/**
 * DX-18 and TX-11: the seller's orders where there is room for more than a column. A desktop reads them as a table
 * (a table beats cards at this volume); a tablet as a list with the chosen order's detail beside it. The chips filter
 * either; the orders are the phone's grouping, drawn flat.
 *
 * The reference's bulk bar (generate waybills, mark as shipped, message buyers) is not drawn: none of it has a route
 * behind it, and a bar of buttons that cannot act is worse than no bar.
 */
export function OrdersWide({
  orders,
  tier,
  notAllLoaded,
  filter,
  onFilter,
  chosen,
  onChoose,
}: {
  orders: readonly Order[];
  tier: Exclude<ViewportTier, 'base'>;
  notAllLoaded: React.ReactNode;
  /** The filter and the chosen order belong to the screen above, which stays mounted across a resize. */
  filter: FilterId;
  onFilter: (filter: FilterId) => void;
  chosen: string | undefined;
  onChoose: (id: string) => void;
}): React.JSX.Element {
  const shown = orders.filter((order) => matches(order, filter));
  return (
    <div className="mx-auto w-full md:max-w-[760px] lg:max-w-none">
      <header className="mb-[16px]">
        <h1 className="m-0 text-[19px] font-semibold">Orders</h1>
        <p className="m-0 mt-[2px] text-[12.5px] text-slate">
          Prepare dispatch and track every active trade.
        </p>
      </header>
      {notAllLoaded}
      <div role="group" aria-label="Filter orders" className="mb-[16px] flex flex-wrap gap-[8px]">
        {FILTERS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            aria-pressed={filter === chip.id}
            onClick={() => onFilter(chip.id)}
            className={[
              'cursor-pointer rounded-full border border-solid px-[12px] py-[6px] text-[12px] font-semibold',
              'focus-visible:outline-[2.5px] focus-visible:outline-offset-[2px] focus-visible:outline-trust-indigo',
              filter === chip.id
                ? 'border-trust-indigo bg-trust-indigo-soft text-info-on-soft'
                : 'border-border-hairline bg-surface-primary text-midnight-text',
            ].join(' ')}
          >
            {`${chip.label} (${String(countFor(orders, chip.id))})`}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState title="Nothing here right now." body="Orders in this stage appear here as they move." />
      ) : tier === 'lg' ? (
        <OrdersTable orders={shown} />
      ) : (
        <OrdersAndDetail orders={shown} chosen={chosen} onChoose={onChoose} />
      )}
      <p className="mb-0 mt-[10px] text-[11px] text-slate">
        {`Showing ${String(shown.length)} of ${String(orders.length)} · newest activity first`}
      </p>
    </div>
  );
}

const TH = 'px-[14px] py-[10px] text-left text-[10.5px] font-semibold uppercase text-slate';
const TD = 'px-[14px] py-[12px] align-middle text-[12.5px]';

function OrdersTable({ orders }: { orders: readonly Order[] }): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-md border border-solid border-border-hairline bg-surface-primary">
      <table aria-label="Orders" className="w-full border-collapse">
        <thead className="bg-surface-secondary">
          <tr>
            <th scope="col" className={TH}>
              Trade
            </th>
            <th scope="col" className={TH}>
              Buyer
            </th>
            <th scope="col" className={TH}>
              Item
            </th>
            <th scope="col" className={TH}>
              Amount
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
            <th scope="col" className={TH}>
              Next step
            </th>
            <th scope="col" className={TH}>
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.trade.id} className="border-t border-solid border-border-hairline">
              <td className={`${TD} font-mono text-[11.5px]`}>{order.trade.tradeCode}</td>
              <td className={TD}>{buyerOf(order) ?? '—'}</td>
              <td className={TD}>{itemOf(order)}</td>
              <td className={`${TD} font-mono font-semibold`}>{amountOf(order)}</td>
              <td className={TD}>
                <Chip tone={toneOf(order)}>{stageTitle(order.stage)}</Chip>
              </td>
              <td className={`${TD} text-slate`}>{nextStep(order.trade)}</td>
              <td className={`${TD} text-right`}>
                <Button asChild variant="secondary">
                  <a href={hrefOf(order)}>
                    {actionOf(order)}
                    <span className="sr-only"> {order.trade.tradeCode}</span>
                  </a>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrdersAndDetail({
  orders,
  chosen,
  onChoose,
}: {
  orders: readonly Order[];
  chosen: string | undefined;
  onChoose: (id: string) => void;
}): React.JSX.Element {
  // The chosen order can leave the list (a filter, a stage change): the pane then follows the first one left.
  const current = orders.find((order) => order.trade.id === chosen) ?? orders[0];
  // Choosing an order moves focus to the pane's heading, so a keyboard or screen-reader user lands on what changed.
  // Only a choice the person made does: the pane following a filter, or the first draw, leaves focus alone.
  const picked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (picked.current) heading.current?.focus();
    picked.current = false;
  }, [chosen]);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-[16px]">
      <ul aria-label="Orders" className="m-0 list-none p-0">
        {orders.map((order) => {
          const selected = order.trade.id === current?.trade.id;
          return (
            <li key={order.trade.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  picked.current = true;
                  onChoose(order.trade.id);
                }}
                className={[
                  'mb-[10px] block w-full cursor-pointer rounded-md border-[1.5px] border-solid bg-surface-primary p-[12px] text-left',
                  'focus-visible:outline-[2.5px] focus-visible:outline-offset-[2px] focus-visible:outline-trust-indigo',
                  selected ? 'border-trust-indigo' : 'border-border-hairline',
                ].join(' ')}
              >
                <span className="mb-[6px] flex items-start justify-between gap-[8px]">
                  <span className="font-mono text-[15px] font-semibold">{amountOf(order)}</span>
                  <Chip tone={toneOf(order)}>{stageTitle(order.stage)}</Chip>
                </span>
                <span className="block text-[12px] text-slate">
                  {itemOf(order)} · {order.trade.tradeCode}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {current !== undefined && <OrderDetail order={current} headingRef={heading} />}
    </div>
  );
}

/** TX-11's detail pane: the order, what is protected, what is next and the one action. */
function OrderDetail({
  order,
  headingRef,
}: {
  order: Order;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}): React.JSX.Element {
  const buyer = buyerOf(order);
  return (
    <section
      aria-label="Order detail"
      className="sticky top-[16px] self-start rounded-md border border-solid border-border-hairline bg-surface-primary p-[16px]"
    >
      <div className="mb-[12px] flex items-center gap-[10px]">
        {buyer !== undefined && (
          <span
            aria-hidden
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-surface-secondary text-[11px] font-bold"
          >
            {initialsOf(buyer.replace(/^@/, ''))}
          </span>
        )}
        <div className="min-w-0">
          <h2 ref={headingRef} tabIndex={-1} className="m-0 text-[14px] font-semibold outline-none">
            {itemOf(order)}
          </h2>
          <p className="m-0 text-[11.5px] text-slate">{order.trade.tradeCode}</p>
        </div>
      </div>
      <dl className="m-0 mb-[14px] text-[12.5px]">
        {buyer !== undefined && <DetailRow label="Buyer">{buyer}</DetailRow>}
        <DetailRow label="Amount">
          <span className="font-mono font-semibold">{amountOf(order)}</span>
        </DetailRow>
        <DetailRow label="Payment">Protected</DetailRow>
        <DetailRow label="Next step">{nextStep(order.trade)}</DetailRow>
      </dl>
      <Button asChild>
        <a href={hrefOf(order)}>{order.stage === 'ready' ? 'Dispatch' : 'Open the trade'}</a>
      </Button>
    </section>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex justify-between gap-[12px] border-b border-solid border-border-hairline py-[8px]">
      <dt className="text-slate">{label}</dt>
      <dd className="m-0 text-right">{children}</dd>
    </div>
  );
}
