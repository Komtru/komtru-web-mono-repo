'use client';

import { useTradeList, useTradeLive } from '@komtru/api-client/react';
import type { TradeListItem } from '@komtru/shared-types';
import { useEffect, useMemo } from 'react';
import { describeTrade } from '../trade/format';

/**
 * Every trade the person is party to, read to the end of the list.
 *
 * Home needs the whole list because "needs your attention" is the server's flag on whichever row carries it, and
 * the list is ordered by relevance, not by that flag. Search needs it because `GET /trades` has no text query, so
 * matching happens here over what is loaded. Pages are read one after another with the cursor exactly as it came.
 *
 * A later page that fails is not retried in a loop: the hook says so (`nextPageFailed`) and the screen offers a
 * retry. The trades still open are subscribed to live updates by id and code; finished ones are not, since they
 * cannot change.
 */
export function useAllTrades(): {
  trades: TradeListItem[];
  /** True once the server has no further page. */
  complete: boolean;
  isPending: boolean;
  isError: boolean;
  nextPageFailed: boolean;
  retry: () => void;
} {
  const list = useTradeList('ALL');
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = list;

  const trades = useMemo(() => (list.data?.pages ?? []).flatMap((page) => page.items), [list.data]);
  // A finished trade cannot move, so it does not need a room: only the trades still open are subscribed.
  const live = useMemo(
    () =>
      trades
        .filter((trade) => !describeTrade(trade).closed)
        .map((trade) => ({ id: trade.id, code: trade.tradeCode })),
    [trades],
  );
  useTradeLive(live);

  useEffect(() => {
    // `cancelRefetch: false`: Shop reads this list twice (its groups and its KPI strip), and both effects fire in
    // the same commit. Without it the second call would cancel and resend the first one's page.
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError)
      void fetchNextPage({ cancelRefetch: false });
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  return {
    trades,
    complete: !hasNextPage,
    isPending: list.isPending,
    // A failed later page also sets the query's error state, but the first page is still on screen: that is
    // `nextPageFailed`, not a failed list.
    isError: list.isError && list.data === undefined,
    nextPageFailed: isFetchNextPageError,
    retry: () => {
      if (list.data === undefined) void list.refetch();
      else void fetchNextPage({ cancelRefetch: false });
    },
  };
}
