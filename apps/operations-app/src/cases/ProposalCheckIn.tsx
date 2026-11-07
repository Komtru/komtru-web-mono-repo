'use client';

// P1 Proposal Queue, the mobile check-in: a glance at flagged proposals, not a way to triage them
// from a thumb. Each card opens the case page, where the evidence and the decision live.
//
// Money is not shown on the cards (the reference prints the trade amount): a case carries no amount
// and the Trades service has no staff read yet. The card shows the trade reference, how urgent it is
// and why it was flagged.
import { Chip, EmptyState, Skeleton } from '@komtru/ui-kit';
import { useEffect } from 'react';
import Link from 'next/link';
import { agoLabel, priorityLabel, stateLabel } from './format';
import { useCaseList } from './hooks';
import { caseHref, QueueFrame } from './shared';

const MAX_LOADED = 250;
const FINISHED = new Set(['DECIDED', 'CLOSED']);

function startOfToday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function ProposalCheckIn(): React.JSX.Element {
  const result = useCaseList({ type: 'TRADE_PROPOSAL' });
  // The platform lists one page at a time and cannot filter on "not finished", so follow the cursor
  // (up to MAX_LOADED cases) until flagged and cleared are both complete.
  const { hasMore, loadingMore, loadMore, cases } = result;
  useEffect(() => {
    if (hasMore && !loadingMore && cases.length < MAX_LOADED) loadMore();
  }, [hasMore, loadingMore, loadMore, cases.length]);
  const now = new Date();
  const midnight = startOfToday(now).getTime();

  const flagged = result.cases.filter((row) => !FINISHED.has(row.state));
  const finishedAt = (row: (typeof result.cases)[number]): string =>
    row.decidedAt ?? row.closedAt ?? row.updatedAt;
  const cleared = result.cases
    .filter((row) => FINISHED.has(row.state) && new Date(finishedAt(row)).getTime() >= midnight)
    .sort((a, b) => finishedAt(b).localeCompare(finishedAt(a)));

  let body: React.ReactNode;
  if (result.loading) {
    body = (
      <div role="status" aria-label="Loading proposals" className="grid gap-[8px]">
        <Skeleton width="full" />
        <Skeleton width="w80" />
      </div>
    );
  } else if (result.failed) {
    body = (
      <EmptyState
        tone="error"
        title="We could not load the proposals"
        body="The list did not load. Reload the page, or check that your role can see cases."
      />
    );
  } else {
    body = (
      <>
        <div className="mb-[14px] flex items-center justify-between gap-[10px]">
          <h2 className="m-0 text-[14px] font-semibold">Trade Proposals</h2>
          {flagged.length > 0 && (
            <Chip
              tone="risk"
              dot={false}
            >{`${flagged.length}${result.hasMore && result.cases.length >= MAX_LOADED ? '+' : ''} flagged`}</Chip>
          )}
        </div>

        {flagged.length === 0 ? (
          <EmptyState
            title="Nothing flagged"
            body="Proposals held for review appear here, most recent first."
          />
        ) : (
          <ul aria-label="Flagged proposals" className="m-0 grid list-none gap-[10px] p-0">
            {flagged.map((row) => (
              <li key={row.id}>
                <Link
                  href={caseHref(row.id)}
                  className="block rounded-md border border-solid border-border-hairline bg-surface-elevated p-[14px]"
                >
                  <span className="block font-mono text-[15px] font-semibold">{row.subjectId}</span>
                  <span className="block text-[11px] text-slate">
                    {`${priorityLabel(row.priority)} · ${stateLabel(row.state)} · ${row.title}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <h3 className="mx-[0px] mb-[6px] mt-[18px] text-[10px] font-normal uppercase tracking-[.05em] text-slate">
          Cleared today
        </h3>
        {cleared.length === 0 ? (
          <p className="text-[12px] text-slate">Nothing has been cleared yet today.</p>
        ) : (
          <ul aria-label="Cleared today" className="m-0 list-none p-0">
            {cleared.map((row) => (
              <li
                key={row.id}
                className="flex justify-between gap-[10px] border-b border-solid border-border-hairline py-[8px] text-[12px] last:border-b-0"
              >
                <span>{`${row.subjectId} · ${stateLabel(row.state)}`}</span>
                <span className="text-info-on-soft">{agoLabel(finishedAt(row), now)}</span>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <QueueFrame
      tab={null}
      title="Proposal check-in"
      description="A glance at flagged proposals. Working one happens on the case page."
    >
      <div className="mx-auto max-w-[420px]">{body}</div>
    </QueueFrame>
  );
}
