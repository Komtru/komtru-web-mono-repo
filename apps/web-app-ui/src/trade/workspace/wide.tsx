'use client';

// DX-21 and TX-13: what the trade workspace adds on a tablet and a desktop. The detail is the same screen the phone
// draws (header, summary card, tabs, the body for the status); around it sit the trade list, so moving between trades
// never leaves the screen, and a context rail of the money and the evidence (F-069, F-073).
import type { TradeView } from '@komtru/api-client';
import { useInspection, useTradeList } from '@komtru/api-client/react';
import { Button, Skeleton, TradeRow, VersionTimeline, type VersionStep } from '@komtru/ui-kit';
import { useEffect, useId, useState } from 'react';
import { describeTrade, initialsOf, nairaShort, partyName, whenLabel } from '../format';
import { MediaGrid, type GridItem } from '../proof/MediaGrid';
import { EVIDENCE_STATUSES, evidenceHref, workspaceStanding, type WorkspaceStatus } from '../workspace-state';
import { Panel } from './layout';
import { MoneyTerms } from './shared';

type Filter = 'active' | 'action' | 'done';

const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'action', label: 'Needs action' },
  { id: 'done', label: 'Completed' },
];

const PILL =
  'rounded-full border-[1.5px] border-solid px-[10px] py-[5px] text-[11.5px] font-semibold focus-visible:outline-[2.5px] focus-visible:outline-trust-indigo focus-visible:outline-offset-[2px]';

/**
 * The trades list beside the detail: the same rows as My Trades, the open one marked, and a filter for the ones that
 * need the person. It is read only here, on a tablet or a desktop; a phone never asks for it.
 */
export function TradePane({
  currentId,
  currentClosed,
}: {
  currentId: string;
  currentClosed: boolean;
}): React.JSX.Element {
  const list = useTradeList('ALL');
  const listId = useId();
  const [filter, setFilter] = useState<Filter>(currentClosed ? 'done' : 'active');
  const all = (list.data?.pages ?? []).flatMap((page) => page.items);
  // The open trade must be in the list or the pane marks nothing: read on until it is, or the list ends.
  const found = all.some((trade) => trade.id === currentId);
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = list;
  useEffect(() => {
    if (!found && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [found, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  const rows = all
    .map((trade) => ({ trade, state: describeTrade(trade) }))
    .filter(({ trade, state }) =>
      filter === 'action' ? trade.attention !== null : filter === 'done' ? state.closed : !state.closed,
    );
  return (
    <aside aria-label="Your trades" className="min-w-0">
      <h2 className="m-0 text-[15px] font-semibold text-midnight-text">Trades</h2>
      <p className="mb-[10px] mt-[2px] text-[11.5px] text-slate">
        Agreement, payment, delivery and inspection in one place.
      </p>
      <div role="group" aria-label="Which trades to list" className="mb-[10px] flex flex-wrap gap-[6px]">
        {FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            aria-controls={listId}
            onClick={() => {
              setFilter(id);
            }}
            className={`${PILL} ${
              filter === id
                ? 'border-trust-indigo bg-trust-indigo-soft text-trust-indigo'
                : 'border-border-hairline bg-surface-primary text-slate'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div id={listId}>
        {list.isPending ? (
          <div role="status" aria-label="Loading your trades" aria-busy="true">
            <Skeleton width="full" lines={3} />
          </div>
        ) : list.isError && list.data === undefined ? (
          <p role="alert" className="text-[12px] text-risk-on-soft">
            We couldn&apos;t load your trades.{' '}
            <button type="button" className="underline" onClick={() => void list.refetch()}>
              Try again
            </button>
          </p>
        ) : rows.length === 0 ? (
          <p className="text-[12px] text-slate">No trades here.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {rows.map(({ trade, state }) => (
              <li key={trade.id} {...(trade.id === currentId ? { 'aria-current': 'true' as const } : {})}>
                <TradeRow
                  amount={trade.itemAmountMinor === null ? '—' : nairaShort(trade.itemAmountMinor)}
                  status={{ tone: state.tone, label: state.label }}
                  {...(trade.counterparty === null
                    ? {}
                    : {
                        counterparty: {
                          name: partyName(trade.counterparty),
                          initials: initialsOf(partyName(trade.counterparty).replace(/^@/, '')),
                        },
                      })}
                  sub={`${trade.item.title ?? trade.item.categoryName ?? 'Trade'} · ${trade.tradeCode}`}
                  href={`/trade/${trade.id}`}
                  className={trade.id === currentId ? 'border-[1.5px] border-trust-indigo' : ''}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      {list.hasNextPage && (
        <Button
          type="button"
          variant="secondary"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </aside>
  );
}

const STAGES = ['Agreement accepted', 'Funds protected', 'Shipped', 'Inspection', 'Release'] as const;

/** The five stages the summary card's bar draws, as the reference's vertical timeline: where the trade has been. */
export function StageTimeline({ trade, status }: { trade: TradeView; status: WorkspaceStatus }) {
  const { stage, closed } = workspaceStanding(status);
  if (stage === undefined) return null;
  const steps: VersionStep[] = STAGES.map((title, index) => {
    const position = index + 1;
    const state = closed || position < stage ? 'done' : position === stage ? 'active' : 'pending';
    return {
      id: title,
      title,
      state,
      ...(position === 1 && trade.acceptedAt !== null
        ? { detail: whenLabel(trade.acceptedAt) }
        : state === 'active'
          ? { detail: 'Now' }
          : {}),
    };
  });
  return (
    <Panel title="Timeline">
      <VersionTimeline steps={steps} aria-label="Where the trade is" />
    </Panel>
  );
}

/**
 * What the platform holds for each side while the trade runs. Only these statuses have money in escrow that the
 * reader is waiting on, so only these draw the panel: before funding nothing is held, a completed trade has its own
 * "Financial outcome", and a decided or refunded one says what happened in its body, because the amount that went
 * where is the ledger's and this screen does not work it out.
 */
const HELD: Partial<Record<WorkspaceStatus, string>> = {
  FUNDED: 'held, not yet released',
  SHIPPED: 'held, not yet released',
  UNCONFIRMED_DELIVERY: 'held, not yet released',
  INSPECTION: 'held, not yet released',
  DISPUTED: 'held while the case is open',
};

/** The money panel's own text for a status: `undefined` where it draws nothing. */
export const heldText = (status: WorkspaceStatus): string | undefined => HELD[status];

/** What the reader's money is doing: the rows the phone draws in its own body, from the trade's fee snapshot. */
export function MoneyPanel({
  trade,
  status,
  className,
}: {
  trade: TradeView;
  status: WorkspaceStatus;
  className?: string;
}): React.JSX.Element | null {
  const held = heldText(status);
  if (held === undefined || trade.fees === null) return null;
  return (
    <Panel title="Money" {...(className === undefined ? {} : { className })}>
      <MoneyTerms trade={trade} role={trade.yourRole} held={held} />
    </Panel>
  );
}

/** The seller's proof as a three-up strip with a way to all of the evidence. */
export function EvidencePanel({
  trade,
  status,
  className,
}: {
  trade: TradeView;
  status: WorkspaceStatus;
  className?: string;
}): React.JSX.Element {
  const readable = (EVIDENCE_STATUSES as readonly string[]).includes(status);
  const inspection = useInspection(trade.id, readable);
  const items: GridItem[] = (inspection.data?.sellerProof?.media ?? []).slice(0, 3).map((file, index) => ({
    id: file.fileId,
    fileId: file.fileId,
    label: `Seller’s proof ${String(index + 1)}`,
  }));
  return (
    <Panel
      title="Seller’s proof"
      {...(className === undefined ? {} : { className })}
      action={
        readable ? (
          <a href={evidenceHref(trade.id)} className="text-[11.5px] font-semibold text-trust-indigo">
            View all evidence
          </a>
        ) : undefined
      }
    >
      {!readable ? (
        <p className="m-0 text-[12px] leading-[1.6] text-slate">
          The seller’s proof appears here once the item has shipped.
        </p>
      ) : inspection.isPending ? (
        <Skeleton width="full" lines={2} />
      ) : inspection.isError ? (
        <p role="alert" className="m-0 text-[12px] text-risk-on-soft">
          We couldn&apos;t load the evidence.{' '}
          <button type="button" className="underline" onClick={() => void inspection.refetch()}>
            Try again
          </button>
        </p>
      ) : items.length === 0 ? (
        <p className="m-0 text-[12px] leading-[1.6] text-slate">
          No proof photos were attached to this trade.
        </p>
      ) : (
        <MediaGrid aria-label="Seller’s proof files" items={items} />
      )}
    </Panel>
  );
}

/** The desktop's rail beside a trade. */
export function ContextRail({
  trade,
  status,
}: {
  trade: TradeView;
  status: WorkspaceStatus;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      <MoneyPanel trade={trade} status={status} />
      <EvidencePanel trade={trade} status={status} />
    </div>
  );
}
