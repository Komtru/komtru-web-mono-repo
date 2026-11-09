'use client';

import { getTrade, ProblemError, type TradeView } from '@komtru/api-client';
import { tradeKeys, useApiClient, useMe } from '@komtru/api-client/react';
import { Button, EmptyState, ScreenColumn, Skeleton, TradeRow } from '@komtru/ui-kit';
import { useQueries } from '@tanstack/react-query';
import { useEffect } from 'react';
import { describeTrade, itemTitle, nairaShort } from './format';
import { forgetTrade, useKnownTradeIds } from './known-trades';

const CODE = /^KMT-\d+$/i;

/** A trade that is gone, or was never this person's, will not come back by reloading. */
const isPermanent = (error: unknown): boolean =>
  error instanceof ProblemError && (error.status === 403 || error.status === 404);

/**
 * Q1 and the buyer's trades tab: every trade this device knows about for this person, with what to do
 * next on each.
 *
 * A trade waiting on you is drawn with the indigo border Q1 gives the one that needs attention, and
 * counted in the line under the heading. The platform has no list route yet, so the rows come from the
 * ids this device holds for the signed-in person (see `known-trades.ts`). An id the platform says is
 * gone or not theirs is dropped from the list rather than reported as a failure every time.
 */
export function MyTrades({ code }: { code?: string }): React.JSX.Element {
  const client = useApiClient();
  const me = useMe();
  const userId = me.data?.id;
  const ids = useKnownTradeIds(userId);

  const results = useQueries({
    queries: (ids ?? []).map((id) => ({
      queryKey: tradeKeys.one(id),
      queryFn: ({ signal }: { signal: AbortSignal }): Promise<TradeView> =>
        client.call(getTrade, { params: { id } }, { signal }),
    })),
  });

  const gone = (ids ?? []).filter((_, index) => isPermanent(results[index]?.error));
  const goneKey = gone.join(',');
  useEffect(() => {
    if (userId === undefined || goneKey === '') return;
    for (const id of goneKey.split(',')) forgetTrade(userId, id);
  }, [userId, goneKey]);

  if (me.isError) {
    return (
      <ScreenColumn>
        <EmptyState
          tone="error"
          title="Couldn't load your trades"
          body="Check your connection and try again."
          action={
            <Button type="button" onClick={() => void me.refetch()}>
              Try again
            </Button>
          }
        />
      </ScreenColumn>
    );
  }

  if (ids === undefined) {
    return (
      <ScreenColumn>
        <div role="status" aria-label="Loading your trades" aria-busy="true">
          <Skeleton width="full" lines={3} />
        </div>
      </ScreenColumn>
    );
  }

  const loaded = results.flatMap((result) => (result.data === undefined ? [] : [result.data]));
  const wanted = code !== undefined && CODE.test(code) ? code.toUpperCase() : undefined;
  const shown =
    wanted === undefined ? loaded : loaded.filter((trade) => trade.tradeCode.toUpperCase() === wanted);
  const states = shown.map((trade) => ({ trade, state: describeTrade(trade) }));
  const attention = states.filter(({ state }) => state.needsYou).length;
  const active = states.filter(({ state }) => !state.closed).length;
  // Only a failure that trying again can fix is reported; permanent ones are pruned.
  const failed = results.filter((result) => result.isError && !isPermanent(result.error)).length;
  const pending = results.some((result) => result.isPending);

  if (ids.length === 0 || (loaded.length === 0 && failed === 0 && !pending)) {
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

  return (
    <ScreenColumn>
      <h1 className="text-[19px] font-semibold">Your Trades</h1>
      <p className="mb-[16px] mt-[3px] text-[11.5px] text-slate">
        {String(attention)} need{attention === 1 ? 's' : ''} your attention · {String(active)} active
      </p>
      {wanted !== undefined && shown.length === 0 && (
        <p className="mb-[12px] text-[12.5px] text-slate">No trade with the code {wanted} on this device.</p>
      )}
      <ul className="m-0 list-none p-0">
        {states.map(({ trade, state }) => (
          <li key={trade.id}>
            <TradeRow
              amount={trade.terms === null ? '—' : nairaShort(trade.terms.itemAmountMinor)}
              status={{ tone: state.tone, label: state.label }}
              sub={`${trade.terms === null ? '' : `${itemTitle(trade.terms.itemSpec, 'Trade')} · `}${state.sub}`}
              href={`/trade/${trade.id}`}
              className={state.needsYou ? 'border-[1.5px] border-trust-indigo' : ''}
            />
          </li>
        ))}
      </ul>
      {failed > 0 && (
        <p role="status" className="text-[11.5px] text-slate">
          {String(failed)} trade{failed === 1 ? '' : 's'} couldn&apos;t be loaded. Reload to try again.
        </p>
      )}
      <Button asChild variant="secondary" className="mt-[8px]">
        <a href="/trade/new">Start a trade</a>
      </Button>
    </ScreenColumn>
  );
}
