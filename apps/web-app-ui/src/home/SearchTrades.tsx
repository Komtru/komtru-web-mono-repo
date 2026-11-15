'use client';

import {
  Button,
  EmptyState,
  LoadFailed,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  TextField,
} from '@komtru/ui-kit';
import { useMemo, useState } from 'react';
import { matchesTradeQuery, tradeCodeOf } from './classify';
import { TradeLine } from './TradeLine';
import { useAllTrades } from './useAllTrades';

/**
 * Search (SE1, SE2): the person's own trades, by item, category, the other party's name or handle, or Trade Code.
 *
 * The platform has no text query on `GET /trades`, so the whole list is read (see `useAllTrades`) and matched here.
 * The search covers trades only: there is no listing index and no seller search. A query that is a Trade Code the
 * person is not party to is offered to Find a Trade, which is where a code is resolved.
 *
 * "No trades match" is only said once every trade has been read; until then the screen says it is still reading.
 */
export function SearchTrades({ initialQuery }: { initialQuery: string }): React.JSX.Element {
  const [query, setQuery] = useState(initialQuery);
  const all = useAllTrades();
  const text = query.trim();
  const code = tradeCodeOf(query);
  const results = useMemo(
    () => (text === '' ? [] : all.trades.filter((trade) => matchesTradeQuery(trade, query))),
    [all.trades, query, text],
  );

  return (
    <ScreenColumn>
      <ScreenHeader title="Search" backHref="/home" />
      <TextField
        type="search"
        label="Search your trades"
        placeholder="Item, name or Trade Code"
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />

      {all.isError ? (
        <div className="mt-[16px]">
          <LoadFailed
            title="Couldn't search your trades"
            body="Check your connection and try again."
            onRetry={all.retry}
          />
        </div>
      ) : all.isPending ? (
        <div role="status" aria-label="Loading your trades" aria-busy="true" className="mt-[16px]">
          <Skeleton width="full" lines={3} />
        </div>
      ) : text === '' ? (
        <p className="mt-[16px] text-[12px] text-slate">Type an item, a name or a Trade Code.</p>
      ) : (
        <div className="mt-[8px]">
          {results.length > 0 && (
            <section aria-label={`Results — "${text}"`}>
              <SectionLabel>{`Results — "${text}"`}</SectionLabel>
              <ul className="m-0 list-none p-0">
                {results.map((trade) => (
                  <li key={trade.id}>
                    <TradeLine trade={trade} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.length === 0 && code !== undefined && (
            <div className="mb-[12px]">
              <Button asChild variant="secondary">
                <a href={`/find?code=${encodeURIComponent(code)}`}>{`Find trade ${code}`}</a>
              </Button>
            </div>
          )}

          {/* With a later page unread, neither "still reading" nor "no match" can ever resolve: the alert below says so. */}
          {results.length === 0 &&
            !all.nextPageFailed &&
            (all.complete ? (
              <EmptyState
                title={`No trades match "${text}"`}
                body="Search covers the trades you are party to. To start one, propose a trade and the other party can respond."
                action={
                  <Button asChild>
                    <a href="/trade/new">Propose a Trade</a>
                  </Button>
                }
              />
            ) : (
              <p role="status" aria-label="Still reading your trades" className="text-[12px] text-slate">
                Still reading your trades…
              </p>
            ))}

          {results.length > 0 && !all.complete && !all.nextPageFailed && (
            <p role="status" className="text-[12px] text-slate">
              More trades may match once the rest are read.
            </p>
          )}
          {all.nextPageFailed && (
            <div role="alert" className="mt-[8px]">
              <p className="mb-[8px] text-[12px] font-semibold text-risk-on-soft">
                {results.length === 0
                  ? "Couldn't read all of your trades, so we can't tell yet whether one matches."
                  : "Couldn't read all of your trades, so some may not appear here."}
              </p>
              <Button type="button" variant="secondary" onClick={all.retry}>
                Try again
              </Button>
            </div>
          )}
        </div>
      )}
    </ScreenColumn>
  );
}
