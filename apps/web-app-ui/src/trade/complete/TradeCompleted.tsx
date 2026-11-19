'use client';

import type { TradeView } from '@komtru/api-client';
import { useTrade, useTradeActivity, useTradeList } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  LoadFailed,
  LoadingScreen,
  SectionLabel,
  Skeleton,
  StatusHero,
  TermList,
  TermRow,
  VersionTimeline,
} from '@komtru/ui-kit';
import { useEffect } from 'react';
import { isProblem, itemTitle, nairaShort, partyName, problemMessage } from '../format';
import { storyOf } from './story';
import { stateCopy } from '../workspace-copy';

const tradeHref = (id: string) => `/trade/${id}`;
const DONE = ['COMPLETED', 'SETTLED'] as const;

/**
 * DX-31: the trade is complete. What it came to, what was agreed and done, and what it added to the person's record.
 * Built for every width: one column on a phone and tablet, two on a desktop (the result and the record on the left,
 * the review and the record on the right).
 *
 * The review form is F-038's and deferred, so the block is drawn with no inputs and says reviews are not open. The
 * amounts are the trade's own fee snapshot, formatted and never added up. `/complete` is the seller completing a
 * buyer's request (F-018), so this screen lives at `/completed`.
 */
export function TradeCompleted({ id }: { id: string }): React.JSX.Element {
  const trade = useTrade(id);
  if (trade.isPending) return <LoadingScreen label="Loading the trade" />;
  if (trade.isError) {
    return (
      <LoadFailed
        title="Couldn’t open this trade"
        body={problemMessage(trade.error, 'Check your connection and try again.')}
        {...(isProblem(trade.error, 'NOT_FOUND') ? {} : { onRetry: () => void trade.refetch() })}
      />
    );
  }
  const view = trade.data;
  if (!(DONE as readonly string[]).includes(view.status)) {
    return (
      <Frame subtitle={view.tradeCode} id={id} title="Trade not complete">
        <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">This trade isn’t complete yet.</p>
        <ActionStack>
          <Button asChild variant="secondary">
            <a href={tradeHref(id)}>Back to the trade</a>
          </Button>
        </ActionStack>
      </Frame>
    );
  }
  return <Completed trade={view} />;
}

function Completed({ trade }: { trade: TradeView }): React.JSX.Element {
  const settled = trade.status === 'SETTLED';
  const { fees } = trade;
  const activity = useTradeActivity(trade.id);
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = activity;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  const copy = stateCopy(settled ? 'SETTLED' : 'COMPLETED', trade.yourRole, {
    itemAmount: fees === null ? undefined : nairaShort(fees.itemAmountMinor),
    proceeds: fees === null ? undefined : nairaShort(fees.sellerProceedsMinor),
    counterparty:
      trade.counterparty === undefined || trade.counterparty === null
        ? undefined
        : partyName(trade.counterparty),
  });
  const read = activity.data !== undefined && !hasNextPage;
  const story = read
    ? storyOf(
        activity.data.pages.flatMap((page) => page.items),
        trade.terms,
        settled,
      )
    : undefined;
  const failed = activity.isError || isFetchNextPageError;
  // The hero and the timeline both depend on how the trade ended, so they wait for the record: a trade that
  // a dispute decided did not release the agreed price, and one that ran out its window was not confirmed.
  const hero =
    story === undefined ? undefined : story.how === 'resolved' ? (
      <StatusHero tone="info" as="h2" title="Settled after a dispute">
        The case was decided and the money moved as it decided. The amounts are on the case.
      </StatusHero>
    ) : settled && copy.hero !== undefined ? (
      <StatusHero tone="success" as="h2" title="Payment released">
        {copy.hero.body}
      </StatusHero>
    ) : (
      copy.banner !== undefined && (
        <StatusHero tone="info" as="h2" title={copy.banner.title}>
          {copy.banner.body}
        </StatusHero>
      )
    );
  const timeline =
    story !== undefined ? (
      <VersionTimeline aria-label="What was done" steps={story.steps} />
    ) : failed ? (
      <p role="alert" className="m-0 text-[12px] text-risk-on-soft">
        The record of what was done couldn’t load.{' '}
        <button type="button" className="underline" onClick={() => void activity.refetch()}>
          Try again
        </button>
      </p>
    ) : (
      <div role="status" aria-label="Loading what was done" aria-busy="true">
        <Skeleton width="full" lines={3} />
      </div>
    );
  return (
    <Frame
      id={trade.id}
      title="Trade completed"
      subtitle="Your completed trade has been added to your record."
    >
      <div className="grid gap-[16px] lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {hero}
          <SectionLabel>Summary</SectionLabel>
          <TermList aria-label="Summary">
            <TermRow label="Trade">{trade.tradeCode}</TermRow>
            {trade.terms !== null && <TermRow label="Item">{itemTitle(trade.terms.itemSpec)}</TermRow>}
          </TermList>
          <SectionLabel>What was done</SectionLabel>
          {timeline}
        </div>
        <div className="min-w-0">
          <section aria-labelledby="review-title" className="mb-[16px]">
            <SectionLabel>
              <span id="review-title">Leave a review</span>
            </SectionLabel>
            <p className="m-0 rounded-md border border-solid border-border-hairline bg-surface-primary p-[14px] text-[12.5px] leading-[1.5] text-slate">
              Reviews aren’t open yet. When they are, you’ll be able to review this trade here.
            </p>
          </section>
          <Record trade={trade} />
          <ActionStack className="mt-[16px]">
            <Button asChild variant="secondary">
              <a href={tradeHref(trade.id)}>Back to the trade</a>
            </Button>
          </ActionStack>
        </div>
      </div>
    </Frame>
  );
}

/** "Added to your record": the person's completed trades, and this trade's category among them. Read to the last page. */
function Record({ trade }: { trade: TradeView }): React.JSX.Element {
  const list = useTradeList('CLOSED');
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = list;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  return (
    <section aria-labelledby="record-title">
      <SectionLabel>
        <span id="record-title">Added to your record</span>
      </SectionLabel>
      {list.isPending || (hasNextPage && !isFetchNextPageError) ? (
        <div role="status" aria-label="Loading your record" aria-busy="true">
          <Skeleton width="full" lines={2} />
        </div>
      ) : list.data === undefined || isFetchNextPageError ? (
        <p role="alert" className="m-0 text-[12px] text-risk-on-soft">
          Your record couldn’t load.{' '}
          <button type="button" className="underline" onClick={() => void list.refetch()}>
            Try again
          </button>
        </p>
      ) : (
        <RecordCounts
          completed={list.data.pages
            .flatMap((page) => page.items)
            .filter((item) => (DONE as readonly string[]).includes(item.status))}
          trade={trade}
        />
      )}
    </section>
  );
}

function RecordCounts({
  completed,
  trade,
}: {
  completed: readonly { item: { categoryCode: string | null } }[];
  trade: TradeView;
}): React.JSX.Element {
  const inCategory =
    trade.categoryCode === null
      ? 0
      : completed.filter((entry) => entry.item.categoryCode === trade.categoryCode).length;
  return (
    <div className="rounded-md border border-solid border-border-hairline bg-surface-primary p-[14px]">
      <p className="m-0 text-[10.5px] uppercase text-slate">Completed trades</p>
      <p className="m-0 mt-[2px] font-mono text-[22px] font-semibold">{String(completed.length)}</p>
      {trade.categoryName !== null && (
        <div className="mt-[10px] flex justify-between border-t border-solid border-border-hairline pt-[10px] text-[12.5px]">
          <span>{trade.categoryName}</span>
          <span className="text-slate">{`${String(inCategory)} ${inCategory === 1 ? 'trade' : 'trades'}`}</span>
        </div>
      )}
    </div>
  );
}

function Frame({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[480px] md:max-w-[760px] lg:max-w-none">
      <a href={tradeHref(id)} className="mb-[8px] inline-block text-[12px] font-semibold text-info-on-soft">
        ‹ Trade
      </a>
      <header className="mb-[16px]">
        <h1 className="m-0 text-[19px] font-semibold">{title}</h1>
        <p className="m-0 mt-[2px] text-[12.5px] text-slate">{subtitle}</p>
      </header>
      {children}
    </div>
  );
}
