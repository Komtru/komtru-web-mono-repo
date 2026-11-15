'use client';

import {
  Button,
  EmptyState,
  LoadFailed,
  NoteBanner,
  ScreenColumn,
  SectionLabel,
  Skeleton,
} from '@komtru/ui-kit';
import type { TradeListItem } from '@komtru/shared-types';
import { splitTrades } from './classify';
import { TradeLine } from './TradeLine';
import { useAllTrades } from './useAllTrades';

/** How many closed trades home shows before pointing at the full list. */
const PAST_SHOWN = 5;

/**
 * The Home tab (Z1 and H-01 with trades; AC1 and H-03 without any).
 *
 * Home lists the person's own trades only, in three groups: what needs them first, what is still moving, and what
 * is finished. There is no discovery feed and no catalogue here, by design. The totals a v2 hero draws (protected
 * balance, all-time trade) are not on the platform yet, so they are not drawn.
 */
export function HomeScreen(): React.JSX.Element {
  const all = useAllTrades();

  if (all.isPending) {
    return (
      <ScreenColumn>
        <div role="status" aria-label="Loading your trades" aria-busy="true">
          <Skeleton width="full" lines={3} />
        </div>
      </ScreenColumn>
    );
  }

  if (all.isError) {
    return (
      <LoadFailed
        title="Couldn't load your trades"
        body="Check your connection and try again."
        onRetry={all.retry}
      />
    );
  }

  if (all.trades.length === 0 && all.complete) return <HomeEmpty />;

  const groups = splitTrades(all.trades);
  const past = groups.past.slice(0, PAST_SHOWN);
  const attentionCount = groups.attention.length;
  const activeCount = groups.active.length;

  return (
    <ScreenColumn>
      <h1 className="text-[19px] font-semibold">Your trades, at a glance</h1>
      <p className="mb-[14px] mt-[3px] text-[11.5px] text-slate">
        {`${String(attentionCount)} need${attentionCount === 1 ? 's' : ''} your attention · ${String(activeCount)} active`}
      </p>

      <nav aria-label="Quick actions" className="mb-[6px] grid grid-cols-3 gap-[8px]">
        <Button asChild variant="secondary">
          <a href="/find">Find a Trade</a>
        </Button>
        <Button asChild variant="secondary">
          <a href="/trade/new">Start a Trade</a>
        </Button>
        <Button asChild variant="secondary">
          <a href="/search">Search</a>
        </Button>
      </nav>

      {attentionCount > 0 && (
        <Group title="Needs your attention" count={attentionCount} trades={groups.attention} />
      )}
      {activeCount > 0 && <Group title="Active trades" count={activeCount} trades={groups.active} />}
      {past.length > 0 && (
        <Group
          title="Past trades"
          count={groups.past.length}
          trades={past}
          footer={
            groups.past.length > PAST_SHOWN ? (
              <a className="text-[12px] font-semibold text-trust-indigo" href="/trades">
                See all trades
              </a>
            ) : undefined
          }
        />
      )}

      {!all.complete && !all.nextPageFailed && (
        <p role="status" className="text-[12px] text-slate">
          Loading the rest of your trades…
        </p>
      )}
      {all.nextPageFailed && (
        <div role="alert" className="mb-[12px]">
          <p className="mb-[8px] text-[12px] font-semibold text-risk-on-soft">
            Couldn&apos;t load all of your trades. Some may be missing here.
          </p>
          <Button type="button" variant="secondary" onClick={all.retry}>
            Try again
          </Button>
        </div>
      )}
      <a className="mt-[4px] block text-[12px] font-semibold text-trust-indigo" href="/trades">
        View all trades
      </a>
    </ScreenColumn>
  );
}

function Group({
  title,
  count,
  trades,
  footer,
}: {
  title: string;
  count: number;
  trades: readonly TradeListItem[];
  footer?: React.ReactNode;
}): React.JSX.Element {
  return (
    <section aria-label={title}>
      <SectionLabel>
        {title} <span className="font-normal">({String(count)})</span>
      </SectionLabel>
      <ul className="m-0 list-none p-0">
        {trades.map((trade) => (
          <li key={trade.id}>
            <TradeLine trade={trade} />
          </li>
        ))}
      </ul>
      {footer}
    </section>
  );
}

/**
 * AC1 and H-03: a person with no trades yet. The reference puts its two actions beneath the panel, not inside
 * it, so they are siblings here.
 */
function HomeEmpty(): React.JSX.Element {
  return (
    <ScreenColumn>
      <h1 className="mb-[10px] text-[19px] font-semibold">Your trades, at a glance</h1>
      <EmptyState
        title="No protected Trades yet"
        body="Start one, or enter a Trade Code from a seller — every completed Trade adds to your Trust Profile."
      />
      <div className="mt-[16px] flex flex-col gap-[8px]">
        <Button asChild>
          <a href="/trade/new">Start a Trade</a>
        </Button>
        <Button asChild variant="secondary">
          <a href="/find">Enter a Trade Code</a>
        </Button>
      </div>
      <div className="mt-[16px]">
        <NoteBanner>
          Agree on the details. Follow the payment and delivery status. Confirm the outcome when your
          obligations are met.
        </NoteBanner>
      </div>
    </ScreenColumn>
  );
}
