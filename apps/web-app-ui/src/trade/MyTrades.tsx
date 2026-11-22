'use client';

import { useTradeList, useTradeLive } from '@komtru/api-client/react';
import { Button, EmptyState, LoadFailed, ScreenColumn, Skeleton, TradeRow } from '@komtru/ui-kit';
import { useEffect, useState } from 'react';
import { describeTrade, initialsOf, nairaShort, partyName } from './format';

/**
 * Q1 and Buy's Trades tab (F-083): the trades the person is buying, with what to do next on each.
 *
 * Rows come from `GET /trades`, newest-relevant first, a page at a time. Whether a trade needs the
 * person is the server's `attention`, never worked out here: a row cannot see a pending extension
 * request or a deadline, so a client rule would be wrong in ways nobody would notice. The list is
 * kept current by the trades' rooms (a push, or a reconnect, reads it again) and, while no socket is
 * delivering, by the timer in `useTradeLive`. Window focus is not a fallback: the app turns that refetch off.
 */
export function MyTrades({ side = 'BUYER' }: { side?: 'BUYER' | 'SELLER' } = {}): React.JSX.Element {
  const list = useTradeList('ALL');
  // F-083: Buy's Trades lists the trades the person is buying (Sell's Orders has the rest). The list endpoint has
  // no side filter, so a page can hold none of this side's trades: keep reading until one does or the list ends,
  // rather than saying "no trades" over trades not yet read.
  const mineSoFar = (list.data?.pages ?? [])
    .flatMap((page) => page.items)
    .filter((trade) => trade.yourRole === side);
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = list;
  // How many of this side's rows were showing when "Show more" was pressed. Reading goes on until a page adds one
  // (a page of only the other side's trades would otherwise make the button look dead), or the list ends.
  const [shownAtMore, setShownAtMore] = useState<number | undefined>(undefined);
  const stillWanted =
    mineSoFar.length === 0 || (shownAtMore !== undefined && mineSoFar.length <= shownAtMore);
  // The page count is a dependency so a page that adds none of this side's rows still moves the effect on: every
  // other input can read the same before and after it.
  const pagesRead = list.data?.pages.length ?? 0;
  useEffect(() => {
    if (stillWanted && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [stillWanted, pagesRead, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  // A trade list gets a push only for rooms it has joined, so it joins the trades it shows and reads the list
  // again when any of them moves, and again on every reconnect. With no live connection it reads on a timer.
  const shown = (list.data?.pages ?? []).flatMap((page) => page.items);
  useTradeLive(shown.map((trade) => ({ id: trade.id, code: trade.tradeCode })));

  if (list.isPending) {
    return (
      <ScreenColumn>
        <div role="status" aria-label="Loading your trades" aria-busy="true">
          <Skeleton width="full" lines={3} />
        </div>
      </ScreenColumn>
    );
  }
  if (list.isError) {
    return (
      <LoadFailed
        title="Couldn't load your trades"
        body="Check your connection and try again."
        onRetry={() => void list.refetch()}
      />
    );
  }

  const trades = list.data.pages.flatMap((page) => page.items).filter((trade) => trade.yourRole === side);
  if (trades.length === 0 && hasNextPage && !isFetchNextPageError) {
    return (
      <ScreenColumn>
        <div role="status" aria-label="Loading your trades" aria-busy="true">
          <Skeleton width="full" lines={3} />
        </div>
      </ScreenColumn>
    );
  }
  if (trades.length === 0) {
    return (
      <ScreenColumn>
        <EmptyState
          title={side === 'SELLER' ? 'No sales yet' : 'No protected trades yet'}
          body={
            side === 'SELLER'
              ? 'Start a trade as the seller and share its Trade Code with your buyer. Every completed trade adds to your Trust Profile.'
              : 'Start one with a seller. Every completed trade adds to your Trust Profile. What you sell is on the Sell side.'
          }
          action={
            <Button asChild>
              <a href="/trade/new">Start a trade</a>
            </Button>
          }
        />
      </ScreenColumn>
    );
  }

  const states = trades.map((trade) => ({ trade, state: describeTrade(trade) }));
  const attention = trades.filter((trade) => trade.attention !== null).length;
  const active = states.filter(({ state }) => !state.closed).length;

  return (
    <ScreenColumn>
      <h1 className="text-[19px] font-semibold">Your Trades</h1>
      <p className="mb-[16px] mt-[3px] text-[11.5px] text-slate">
        {String(attention)} need{attention === 1 ? 's' : ''} your attention · {String(active)} active
      </p>
      <ul className="m-0 list-none p-0">
        {states.map(({ trade, state }) => (
          <li key={trade.id}>
            <TradeRow
              amount={trade.itemAmountMinor === null ? '—' : nairaShort(trade.itemAmountMinor)}
              status={{ tone: state.tone, label: state.label }}
              {...(trade.counterparty === null
                ? {}
                : {
                    counterparty: {
                      name: partyName(trade.counterparty),
                      initials: initialsOf(partyName(trade.counterparty).replace(/^@/, '')),
                    },
                  })}
              sub={`${trade.item.title ?? trade.item.categoryName ?? 'Trade'} · ${state.sub}`}
              href={`/trade/${trade.id}`}
              className={trade.attention === null ? '' : 'border-[1.5px] border-trust-indigo'}
            />
          </li>
        ))}
      </ul>
      {list.hasNextPage && (
        <Button
          type="button"
          variant="secondary"
          disabled={list.isFetchingNextPage}
          onClick={() => setShownAtMore(trades.length)}
        >
          {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </Button>
      )}
      {list.isFetchNextPageError && (
        <p role="alert" className="mt-[8px] text-[12px] font-semibold text-risk-on-soft">
          Couldn&apos;t load more trades. Try again.
        </p>
      )}
      <Button asChild variant="secondary" className="mt-[8px]">
        <a href="/trade/new">Start a trade</a>
      </Button>
    </ScreenColumn>
  );
}
