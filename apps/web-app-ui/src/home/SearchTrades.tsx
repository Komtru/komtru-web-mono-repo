'use client';

import {
  Button,
  EmptyState,
  LoadFailed,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  TextField,
} from '@komtru/ui-kit';
import type { TradeListItem } from '@komtru/shared-types';
import { useMemo, useState } from 'react';
import { describeTrade } from '../trade/format';
import { matchesTradeQuery, tradeCodeOf } from './classify';
import { TradeLine } from './TradeLine';
import { useAllTrades } from './useAllTrades';

/** DX-06's filters, over what the person's own trades can say about themselves. */
const SIDES = [
  { id: 'all', label: 'All' },
  { id: 'BUYER', label: 'Buying' },
  { id: 'SELLER', label: 'Selling' },
] as const;
const STATES = [
  { id: 'all', label: 'Any state' },
  { id: 'attention', label: 'Needs you' },
  { id: 'active', label: 'Active' },
  { id: 'past', label: 'Past' },
] as const;
type SideFilter = (typeof SIDES)[number]['id'];
type StateFilter = (typeof STATES)[number]['id'];

/** Which state group a trade is in: the server's `attention` first, then the trade module's own reading. */
const stateOf = (trade: TradeListItem): Exclude<StateFilter, 'all'> =>
  trade.attention !== null ? 'attention' : describeTrade(trade).closed ? 'past' : 'active';

/**
 * Search (SE1, SE2, and DX-06 and TX-05 at width): the person's own trades, by item, category, the other party's name or handle, or Trade Code.
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
  const [side, setSide] = useState<SideFilter>('all');
  const [state, setState] = useState<StateFilter>('all');
  const results = useMemo(
    () =>
      text === ''
        ? []
        : all.trades.filter(
            (trade) =>
              matchesTradeQuery(trade, query) &&
              (side === 'all' || trade.yourRole === side) &&
              (state === 'all' || stateOf(trade) === state),
          ),
    [all.trades, query, text, side, state],
  );
  const filtered = side !== 'all' || state !== 'all';
  // Whether the query matches any trade before the filters: a code the person is party to but has filtered out
  // is theirs, so it is not offered to Find a Trade as if it were someone else's.
  const anyMatch = text !== '' && all.trades.some((trade) => matchesTradeQuery(trade, query));

  // DX-06: the filters stay open in a column on the left of a desktop window and the results run two to a row;
  // TX-05 and a phone put the filters in a row of chips above the results.
  return (
    <div className="mx-auto w-full max-w-[480px] md:max-w-[760px] lg:max-w-none">
      <ScreenHeader title="Search" backHref="/home" />
      {/* Reading order is the search box, then the filters, then the results, at every width. On a desktop
          window grid placement moves the filters into the left column without changing that order. */}
      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start lg:gap-x-[24px]">
        <div className="lg:col-start-2 lg:row-start-1">
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
        </div>
        <aside aria-label="Filters" className="mt-[10px] lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:mt-0">
          <FilterGroup label="Side" options={SIDES} value={side} onChange={setSide} />
          <FilterGroup label="State" options={STATES} value={state} onChange={setState} />
        </aside>
        <div className="lg:col-start-2 lg:row-start-2">
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
                  <ul className="m-0 list-none p-0 md:grid md:grid-cols-2 md:gap-x-[12px]">
                    {results.map((trade) => (
                      <li key={trade.id}>
                        <TradeLine trade={trade} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {!anyMatch && code !== undefined && (
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
                    body={
                      filtered
                        ? 'None of your trades match with these filters. Try All and Any state.'
                        : 'Search covers the trades you are party to. To start one, propose a trade and the other party can respond.'
                    }
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
        </div>
      </div>
    </div>
  );
}

/** One filter: a row of chips on a phone and a tablet, a stacked list in DX-06's left column. */
function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}): React.JSX.Element {
  return (
    <div role="group" aria-label={label} className="mb-[8px] lg:mb-[16px]">
      <p className="mb-[6px] hidden text-[11px] font-semibold uppercase tracking-[.04em] text-slate lg:block">
        {label}
      </p>
      <div className="flex flex-wrap gap-[6px] lg:flex-col lg:gap-[4px]">
        {options.map((option) => {
          const pressed = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={pressed}
              onClick={() => onChange(option.id)}
              className={
                pressed
                  ? 'rounded-full border border-solid border-trust-indigo bg-trust-indigo-soft px-[10px] py-[5px] text-left text-[12px] font-semibold text-info-on-soft lg:rounded-md'
                  : 'rounded-full border border-solid border-border-hairline bg-surface-primary px-[10px] py-[5px] text-left text-[12px] text-midnight-text hover:border-trust-indigo lg:rounded-md'
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
