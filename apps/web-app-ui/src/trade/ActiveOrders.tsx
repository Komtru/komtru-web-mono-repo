'use client';

import type { TradeListItem } from '@komtru/shared-types';
import { useTradeList, useTradeLive } from '@komtru/api-client/react';
import {
  Button,
  EmptyState,
  LoadFailed,
  ScreenColumn,
  SectionLabel,
  Skeleton,
  TradeRow,
} from '@komtru/ui-kit';
import { useEffect } from 'react';
import { describeTrade, initialsOf, nairaShort, partyName } from './format';
import { shipHref, tabHref } from './workspace-state';

/** The custody stages of AC8, in the order an order moves through them. */
const STAGES = [
  { id: 'ready', title: 'Ready to ship', statuses: ['FUNDED'] },
  { id: 'transit', title: 'In transit', statuses: ['SHIPPED', 'UNCONFIRMED_DELIVERY'] },
  { id: 'inspection', title: 'Awaiting buyer inspection', statuses: ['INSPECTION'] },
] as const;

/**
 * AC8: the seller's orders grouped by where the item is, fuller than the shop's short attention list. The list is
 * `GET /trades` (open trades), read to the last page, because a stage that is missing an order on a later page is
 * worse than a slow screen; what is shown is the trades the person SELLS, by status. A trade to ship goes to the
 * ship screen, the rest to the trade.
 */
export function ActiveOrders(): React.JSX.Element {
  const list = useTradeList('OPEN');
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = list;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  const shown = (list.data?.pages ?? []).flatMap((page) => page.items);
  useTradeLive(shown.map((trade) => ({ id: trade.id, code: trade.tradeCode })));

  if (list.isPending) {
    return (
      <ScreenColumn>
        <div role="status" aria-label="Loading your orders" aria-busy="true">
          <Skeleton width="full" lines={3} />
        </div>
      </ScreenColumn>
    );
  }
  if (list.isError) {
    return (
      <LoadFailed
        title="Couldn’t load your orders"
        body="Check your connection and try again."
        onRetry={() => void list.refetch()}
      />
    );
  }

  const selling = shown.filter((trade) => trade.yourRole === 'SELLER');
  const groups = STAGES.map((stage) => ({
    ...stage,
    trades: selling.filter((trade) => (stage.statuses as readonly string[]).includes(trade.status)),
  })).filter((group) => group.trades.length > 0);

  if (groups.length === 0) {
    return (
      <ScreenColumn>
        <EmptyState
          title="No orders to fulfil"
          body="When a buyer funds a trade with you, it appears here ready to ship."
          action={
            <Button asChild variant="secondary">
              <a href="/trades">See all your trades</a>
            </Button>
          }
        />
      </ScreenColumn>
    );
  }

  return (
    <ScreenColumn>
      <h1 className="mb-[16px] text-[19px] font-semibold">Active Orders</h1>
      {groups.map((group) => (
        <section key={group.id} className="mb-[8px]">
          <SectionLabel>
            {group.title}
            <span aria-hidden className="ml-[6px] text-trust-gray">
              {String(group.trades.length)}
            </span>
          </SectionLabel>
          <ul aria-label={group.title} className="m-0 list-none p-0">
            {group.trades.map((trade) => (
              <li key={trade.id}>
                <OrderRow trade={trade} ship={group.id === 'ready'} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </ScreenColumn>
  );
}

function OrderRow({ trade, ship }: { trade: TradeListItem; ship: boolean }): React.JSX.Element {
  const state = describeTrade(trade);
  const buyer = trade.counterparty === null ? undefined : partyName(trade.counterparty);
  return (
    <TradeRow
      amount={trade.itemAmountMinor === null ? '—' : nairaShort(trade.itemAmountMinor)}
      status={{ tone: state.tone, label: state.label }}
      {...(buyer === undefined
        ? {}
        : { counterparty: { name: buyer, initials: initialsOf(buyer.replace(/^@/, '')) } })}
      sub={`${trade.item.title ?? trade.item.categoryName ?? 'Trade'} · ${trade.tradeCode}`}
      href={ship ? shipHref(trade.id) : tabHref(trade.id, 'overview')}
    />
  );
}
