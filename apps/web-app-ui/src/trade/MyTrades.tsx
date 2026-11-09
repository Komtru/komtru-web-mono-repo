'use client';

import { useTradeList, useTradeLive } from '@komtru/api-client/react';
import { Button, EmptyState, LoadFailed, ScreenColumn, Skeleton, TradeRow } from '@komtru/ui-kit';
import { describeTrade, initialsOf, nairaShort, partyName } from './format';

/**
 * Q1 and the buyer's trades tab: every trade the person is a party to, with what to do next on each.
 *
 * Rows come from `GET /trades`, newest-relevant first, a page at a time. Whether a trade needs the
 * person is the server's `attention`, never worked out here: a row cannot see a pending extension
 * request or a deadline, so a client rule would be wrong in ways nobody would notice. The list is
 * kept current by the trades' rooms (a push, or a reconnect, reads it again) and, while no socket is
 * delivering, by the timer in `useTradeLive`. Window focus is not a fallback: the app turns that refetch off.
 */
export function MyTrades(): React.JSX.Element {
  const list = useTradeList('ALL');
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

  const trades = list.data.pages.flatMap((page) => page.items);
  if (trades.length === 0) {
    return (
      <ScreenColumn>
        <EmptyState
          title="No protected trades yet"
          body="Start one with a seller or a buyer. Every completed trade adds to your Trust Profile."
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
          onClick={() => void list.fetchNextPage()}
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
