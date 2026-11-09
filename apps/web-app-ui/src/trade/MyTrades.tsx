'use client';

import { useApiClient } from '@komtru/api-client/react';
import { getTrade, type TradeView } from '@komtru/api-client';
import { tradeKeys } from '@komtru/api-client/react';
import { Button, EmptyState, Skeleton, TradeRow } from '@komtru/ui-kit';
import { useQueries } from '@tanstack/react-query';
import { describeTrade, itemTitle, nairaShort } from './format';
import { useKnownTradeIds } from './known-trades';
import { Column } from './parts';

const CODE = /^KMT-\d+$/i;

/**
 * Q1 and the buyer's trades tab: every trade this device knows about, with what to do next on each.
 *
 * A trade waiting on you is drawn with the indigo border Q1 gives the one that needs attention, and
 * counted in the line under the heading. The platform has no list route yet, so the rows come from the
 * ids this device holds (see `known-trades.ts`); a trade somebody invited you to joins the list when
 * you open it.
 */
export function MyTrades({ code }: { code?: string }): React.JSX.Element {
  const client = useApiClient();
  const ids = useKnownTradeIds();

  const results = useQueries({
    queries: (ids ?? []).map((id) => ({
      queryKey: tradeKeys.one(id),
      queryFn: ({ signal }: { signal: AbortSignal }): Promise<TradeView> =>
        client.call(getTrade, { params: { id } }, { signal }),
    })),
  });

  if (ids === undefined) {
    return (
      <Column>
        <Skeleton width="full" lines={3} />
      </Column>
    );
  }

  const loaded = results.flatMap((result) => (result.data === undefined ? [] : [result.data]));
  const wanted = code !== undefined && CODE.test(code) ? code.toUpperCase() : undefined;
  const shown =
    wanted === undefined ? loaded : loaded.filter((trade) => trade.tradeCode.toUpperCase() === wanted);
  const states = shown.map((trade) => ({ trade, state: describeTrade(trade) }));
  const attention = states.filter(({ state }) => state.needsYou).length;
  const active = states.filter(({ state }) => !state.closed).length;
  const failed = results.filter((result) => result.isError).length;

  if (
    ids.length === 0 ||
    (loaded.length === 0 && failed === 0 && results.every((result) => !result.isPending))
  ) {
    return (
      <Column>
        <EmptyState
          title="No protected trades yet"
          body="Start one with a seller or a buyer. Every completed trade adds to your Trust Profile."
          action={
            <Button asChild>
              <a href="/trade/new">Start a trade</a>
            </Button>
          }
        />
      </Column>
    );
  }

  return (
    <Column>
      <h1 className="text-[19px] font-semibold">Your Trades</h1>
      <p className="mb-[16px] mt-[3px] text-[11.5px] text-slate">
        {String(attention)} need{attention === 1 ? 's' : ''} your attention · {String(active)} active
      </p>
      {wanted !== undefined && shown.length === 0 && (
        <p className="mb-[12px] text-[12.5px] text-slate">
          No trade with the code {wanted} on this device. Open the link you were sent to add it.
        </p>
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
    </Column>
  );
}
