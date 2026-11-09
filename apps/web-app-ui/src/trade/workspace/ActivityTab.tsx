'use client';

import type { TradeView } from '@komtru/api-client';
import { useTradeActivity } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  NoteBanner,
  RiskBanner,
  Skeleton,
  VersionTimeline,
  type VersionStep,
} from '@komtru/ui-kit';
import { whenLabel } from '../format';
import { describeActivity, tabHref } from '../workspace-state';

/** CWT-08: a read-only record of what happened, who acted and when. */
export function ActivityTab({ trade }: { trade: TradeView }): React.JSX.Element {
  const feed = useTradeActivity(trade.id);

  if (feed.isPending) {
    return (
      <div role="status" aria-label="Loading the activity" aria-busy="true">
        <Skeleton width="full" lines={4} />
      </div>
    );
  }
  if (feed.isError) {
    return (
      <RiskBanner title="Couldn't load the activity">
        <button type="button" className="underline" onClick={() => void feed.refetch()}>
          Try again
        </button>
      </RiskBanner>
    );
  }

  const items = feed.data.pages.flatMap((page) => page.items);
  const steps: VersionStep[] = items.map((item) => {
    const { title, detail } = describeActivity(item, trade.yourRole);
    return {
      id: item.id,
      title,
      detail: [whenLabel(item.occurredAt), ...detail].join(' · '),
      state: 'done',
    };
  });

  return (
    <>
      <NoteBanner title="Read only">A record of what happened, who acted and when. Newest first.</NoteBanner>
      {steps.length === 0 ? (
        <p className="text-[12.5px] text-slate">Nothing has happened on this trade yet.</p>
      ) : (
        <VersionTimeline aria-label="Trade activity" steps={steps} />
      )}
      {feed.hasNextPage && (
        <Button
          type="button"
          variant="secondary"
          className="mt-[12px]"
          disabled={feed.isFetchingNextPage}
          onClick={() => void feed.fetchNextPage()}
        >
          {feed.isFetchingNextPage ? 'Loading…' : 'Show earlier activity'}
        </Button>
      )}
      {feed.isFetchNextPageError && (
        <p role="alert" className="mt-[8px] text-[12px] font-semibold text-risk-on-soft">
          Couldn&apos;t load earlier activity. Try again.
        </p>
      )}
      <p className="mt-[14px] text-[11.5px] leading-[1.6] text-trust-gray">
        Each change to the trade is recorded with who made it and when. Komtru&apos;s own steps, including its
        reviewers and the payment service, appear simply as Komtru.
      </p>
      <ActionStack>
        <Button asChild variant="secondary">
          <a href={tabHref(trade.id, 'overview')}>Back to trade overview</a>
        </Button>
      </ActionStack>
    </>
  );
}
