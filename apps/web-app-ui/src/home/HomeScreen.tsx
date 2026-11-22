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
import { useMemo } from 'react';
import { splitTrades } from './classify';
import { TradeLine } from './TradeLine';
import { VerificationChecklist } from './VerificationChecklist';
import type { DashboardSide } from './verificationSteps';
import { useAllTrades } from './useAllTrades';

/** How many closed trades home shows before pointing at the full list. */
const PAST_SHOWN = 5;

/** Which side's dashboard this is (F-083): Buy's Home or Sell's Shop. */
export type { DashboardSide };

const COPY: Record<
  DashboardSide,
  {
    title: string;
    loading: string;
    active: string;
    past: string;
    all: string;
    seeAll: string;
    allHref: string;
  }
> = {
  BUYER: {
    title: 'Your trades, at a glance',
    loading: 'Loading your trades',
    active: 'Active trades',
    past: 'Past trades',
    all: 'View all trades',
    seeAll: 'See all trades',
    allHref: '/trades',
  },
  SELLER: {
    title: 'Your selling activity',
    loading: 'Loading your sales',
    active: 'Active orders',
    past: 'Past sales',
    // Sell's /trades: every sale, past and pending, which Orders (open custody stages only) is not.
    all: 'View all sales',
    seeAll: 'See all sales',
    allHref: '/trades',
  },
};

/**
 * A mode's dashboard (F-083). Buy's Home (Z1, H-01, DX-03; AC1 and H-03 without any trades) lists the trades the
 * person is buying; Sell's Shop (Seller-1, H-02, DX-04) lists the ones they are selling, under `header`, the shop's
 * KPI strip. Each is in three groups: what needs them first, what is still moving, and what is finished.
 *
 * There is no discovery feed and no catalogue here, by design. The totals a v2 hero draws (protected balance,
 * all-time trade, in escrow) are not on the platform yet, so they are not drawn: a money figure the backend does
 * not report is never summed here.
 */
export function HomeScreen({
  side = 'BUYER',
  header,
}: {
  side?: DashboardSide;
  header?: React.ReactNode;
} = {}): React.JSX.Element {
  const loaded = useAllTrades();
  const copy = COPY[side];
  const mine = useMemo(() => loaded.trades.filter((trade) => trade.yourRole === side), [loaded.trades, side]);
  const all = { ...loaded, trades: mine };

  if (all.isPending) {
    return (
      <ScreenColumn>
        <div role="status" aria-label={copy.loading} aria-busy="true">
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

  // Nothing read yet, and the rest could not be read: "no protected Trades yet" would be a claim nobody has checked.
  if (all.trades.length === 0 && !all.complete) {
    if (all.nextPageFailed) {
      return (
        <LoadFailed
          title="Couldn't load your trades"
          body="Check your connection and try again."
          onRetry={all.retry}
        />
      );
    }
    return (
      <ScreenColumn>
        <div role="status" aria-label={copy.loading} aria-busy="true">
          <Skeleton width="full" lines={3} />
        </div>
      </ScreenColumn>
    );
  }
  if (all.trades.length === 0) return side === 'SELLER' ? <ShopEmpty header={header} /> : <HomeEmpty />;

  const groups = splitTrades(all.trades);
  const past = groups.past.slice(0, PAST_SHOWN);
  const attentionCount = groups.attention.length;
  const activeCount = groups.active.length;

  // Tablet and desktop read the groups as two panels side by side (TX-02); a phone keeps one column.
  return (
    <div className="mx-auto w-full max-w-[480px] md:max-w-[760px] lg:max-w-none">
      <h1 className="text-[19px] font-semibold">{copy.title}</h1>
      <p className="mb-[14px] mt-[3px] text-[11.5px] text-slate">
        {`${String(attentionCount)} need${attentionCount === 1 ? 's' : ''} your attention · ${String(activeCount)} active`}
      </p>

      {/* F-084: what verification is still owed comes before everything else on the dashboard. */}
      <VerificationChecklist side={side} />
      {header}

      <nav aria-label="Quick actions" className="mb-[6px] grid grid-cols-2 gap-[8px] md:grid-cols-3">
        <Button asChild variant="secondary">
          <a href="/find">Find a Trade</a>
        </Button>
        {/* Mobile starts a trade from the tab bar's raised action instead (owner ruling 2026-11-20). */}
        <div className="hidden md:block">
          <Button asChild variant="secondary">
            <a href="/trade/new">Start a Trade</a>
          </Button>
        </div>
        <Button asChild variant="secondary">
          <a href="/search">Search</a>
        </Button>
      </nav>

      <div className="md:grid md:grid-cols-2 md:items-start md:gap-x-[16px]">
        {attentionCount > 0 && (
          <Group title="Needs your attention" count={attentionCount} trades={groups.attention} />
        )}
        {activeCount > 0 && <Group title={copy.active} count={activeCount} trades={groups.active} />}
        {past.length > 0 && (
          <Group
            title={copy.past}
            count={groups.past.length}
            trades={past}
            footer={
              groups.past.length > PAST_SHOWN ? (
                <a className="text-[12px] font-semibold text-trust-indigo" href={copy.allHref}>
                  {copy.seeAll}
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
      </div>
      <a className="mt-[4px] block text-[12px] font-semibold text-trust-indigo" href={copy.allHref}>
        {copy.all}
      </a>
    </div>
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

/** The wallet the AC1 panel draws above its title (`.state-panel .icon-wrap`). */
const EMPTY_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-[24px] w-[24px]"
    aria-hidden
  >
    <rect x="4" y="7" width="16" height="12" rx="2.5" />
    <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" />
  </svg>
);

/**
 * AC1 and H-03: a person with no trades yet. The reference puts its two actions beneath the panel, not inside
 * it, so they are siblings here.
 */
function HomeEmpty(): React.JSX.Element {
  return (
    <ScreenColumn>
      {/* The reference draws no heading over this panel; the page still needs its one `h1`, so it is read, not seen. */}
      <h1 className="sr-only">Your trades, at a glance</h1>
      <VerificationChecklist side="BUYER" />
      <EmptyState
        icon={EMPTY_ICON}
        title="No protected Trades yet"
        body="Start one, or enter a Trade Code from a seller — every completed Trade adds to your Trust Profile."
      />
      <div className="mt-[16px] flex flex-col gap-[8px]">
        {/* On mobile the tab bar's raised action is the way to start one. */}
        <div className="hidden md:block">
          <Button asChild>
            <a href="/trade/new">Start a Trade</a>
          </Button>
        </div>
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

/** Sell's Shop with nothing sold yet: the KPI strip still shows, then a way to start selling. */
function ShopEmpty({ header }: { header?: React.ReactNode }): React.JSX.Element {
  return (
    <ScreenColumn>
      <h1 className="mb-[14px] text-[19px] font-semibold">Your selling activity</h1>
      <VerificationChecklist side="SELLER" />
      {header}
      <EmptyState
        icon={EMPTY_ICON}
        title="No sales yet"
        body="Start a trade as the seller and share its Trade Code with your buyer. Their money is held before you ship."
      />
      <div className="mt-[16px] hidden md:block">
        <Button asChild>
          <a href="/trade/new">Start a Trade</a>
        </Button>
      </div>
    </ScreenColumn>
  );
}
