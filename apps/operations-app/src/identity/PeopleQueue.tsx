'use client';

// OP-05 People: individuals and businesses waiting to be verified, and the duplicate-identity flags.
//
// What the reference draws and the platform cannot answer is not drawn: a person's or a business's
// name and the provider's own wording are held out of the review queue on purpose (T-050, D1), so
// "Who" is the kind of check plus the tail of the user's id, and "Provider result" is what the queue
// does carry, that a person is needed and whether a duplicate flag holds the request. The chip counts
// ("All (9)") need totals per kind that the queue does not return, so the chips carry no counts.
// "Park network applications" belongs to the Park hub ticket (T-147).
import type { DuplicateFlag, KycQueueItem } from '@komtru/api-client';
import { Button, Chip, DataTable, EmptyState, FilterBar, Skeleton, type DataColumn } from '@komtru/ui-kit';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { agoLabel } from '../cases/format';
import { useStaffViewer } from '../shell/viewer';
import {
  FLAG_OPEN,
  OVER_A_DAY_HOURS,
  flagStatusLabel,
  isBusiness,
  providerResult,
  shortUser,
  verificationLabel,
  waitingHours,
  waitingLabel,
} from './format';
import { useDuplicateFlags, useKycQueue, type PagedResult } from './hooks';
import { IdentityFrame, identityHref } from './shared';

type Kind = 'all' | 'IDENTITY' | 'KYB' | 'over-a-day';

const CHIPS: readonly { id: Kind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'IDENTITY', label: 'Individuals' },
  { id: 'KYB', label: 'Businesses' },
  { id: 'over-a-day', label: 'Waiting over 24h' },
];

function ReviewLink({ requestId, who }: { requestId: string; who: string }): React.JSX.Element {
  return (
    <Link
      href={identityHref(requestId)}
      aria-label={`Review ${who}`}
      className="inline-block rounded-md border-[1.5px] border-solid border-border-hairline bg-surface-elevated px-[20px] py-[10px] text-[13px] font-semibold text-midnight-text"
    >
      Review
    </Link>
  );
}

export function ListStates<T>({
  result,
  caption,
  noun,
  emptyTitle,
  emptyBody,
  failedTitle,
  rows,
  columns,
  rowKey,
}: {
  result: PagedResult<T>;
  caption: string;
  noun: string;
  emptyTitle: string;
  emptyBody: string;
  failedTitle: string;
  rows: T[];
  columns: readonly DataColumn<T>[];
  rowKey: (row: T) => string;
}): React.JSX.Element {
  if (result.loading) {
    return (
      <div role="status" aria-label={`Loading ${noun}`} className="grid gap-[8px]">
        <Skeleton width="full" />
        <Skeleton width="full" />
        <Skeleton width="full" />
      </div>
    );
  }
  if (result.failed) {
    return (
      <EmptyState
        tone="error"
        title={failedTitle}
        body="The list did not load. Try again, or check that your role can see it."
        action={
          <Button type="button" onClick={result.retry} className="w-auto!">
            Try again
          </Button>
        }
      />
    );
  }
  if (rows.length === 0 && !result.hasMore) return <EmptyState title={emptyTitle} body={emptyBody} />;
  return (
    <DataTable
      caption={caption}
      rows={rows}
      rowKey={rowKey}
      columns={columns}
      empty="Nothing in the pages loaded so far."
      footer={
        <>
          <span>
            Showing {rows.length}
            {result.hasMore ? ' so far' : ''}
          </span>
          {result.hasMore && (
            <Button
              type="button"
              variant="secondary"
              disabled={result.loadingMore}
              onClick={result.loadMore}
              className="w-auto!"
            >
              {result.loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </>
      }
    />
  );
}

function Queue(): React.JSX.Element {
  const [kind, setKind] = useState<Kind>('all');
  const platformType = kind === 'IDENTITY' || kind === 'KYB' ? kind : undefined;
  const result = useKycQueue(platformType, true);
  // Over-a-day is a screen filter: the queue has no age filter. A filter that only read the first page
  // would answer "none" while the old ones sat on page two, so it keeps loading until the queue ends.
  const { hasMore, loadingMore, loadMore } = result;
  useEffect(() => {
    if (kind === 'over-a-day' && hasMore && !loadingMore) loadMore();
  }, [kind, hasMore, loadingMore, loadMore]);
  const now = new Date();
  const rows =
    kind === 'over-a-day'
      ? result.rows.filter((row) => waitingHours(row.submittedAt, now) >= OVER_A_DAY_HOURS)
      : result.rows;

  const columns: DataColumn<KycQueueItem>[] = [
    {
      key: 'who',
      header: 'Who',
      render: (row) => (
        <>
          <b>{verificationLabel(row.verificationType)}</b>
          <div className="font-mono text-[11px] text-slate">
            {row.caseNumber} · user {shortUser(row.userId)}
          </div>
        </>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => (
        <Chip tone="verified" dot={false}>
          {isBusiness(row.caseType) ? 'Business' : 'Individual'}
        </Chip>
      ),
    },
    {
      key: 'result',
      header: 'Provider result',
      render: (row) => {
        const outcome = providerResult(row);
        return <Chip tone={outcome.tone}>{outcome.label}</Chip>;
      },
    },
    {
      key: 'waiting',
      header: 'Waiting',
      render: (row) => (
        <span
          className={
            waitingHours(row.submittedAt, now) >= OVER_A_DAY_HOURS
              ? 'font-mono text-[12px] font-semibold text-warning-on-soft'
              : 'font-mono text-[12px] font-semibold text-success-on-soft'
          }
        >
          {waitingLabel(row.submittedAt, now)}
        </span>
      ),
    },
    {
      key: 'review',
      header: 'Action',
      render: (row) => (
        <ReviewLink
          requestId={row.requestId}
          who={`${verificationLabel(row.verificationType)} ${row.caseNumber}`}
        />
      ),
    },
  ];

  return (
    <>
      <FilterBar
        label="Show"
        chips={CHIPS.map((chip) => ({ id: chip.id, label: chip.label, active: kind === chip.id }))}
        onChipToggle={(id) => setKind(id as Kind)}
      />
      <ListStates
        result={result}
        caption="Verification queue"
        noun="the verification queue"
        emptyTitle="Nobody is waiting"
        emptyBody="Nothing needs a person right now. New items appear here as soon as a check is parked for review."
        failedTitle="We could not load the queue"
        rows={rows}
        columns={columns}
        rowKey={(row) => row.requestId}
      />
    </>
  );
}

function Flags(): React.JSX.Element {
  const result = useDuplicateFlags(true);
  // The ones that still need a person come first; the platform's order (newest first) holds within each group.
  const rows = [...result.rows].sort(
    (a, b) => Number(!FLAG_OPEN.includes(a.status)) - Number(!FLAG_OPEN.includes(b.status)),
  );
  const columns: DataColumn<DuplicateFlag>[] = [
    {
      key: 'identifier',
      header: 'Identifier',
      render: (row) => (
        <>
          <b>{row.identifierType} already verified elsewhere</b>
          <div className="font-mono text-[11px] text-slate">
            claimed by user {shortUser(row.conflictingUserId)}, held by user {shortUser(row.firstUserId)}
          </div>
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Chip tone={FLAG_OPEN.includes(row.status) ? 'risk' : 'resolved'}>{flagStatusLabel(row.status)}</Chip>
      ),
    },
    {
      key: 'detected',
      header: 'Raised',
      render: (row) => <span className="font-mono text-[12px]">{agoLabel(row.detectedAt)} ago</span>,
    },
    {
      key: 'review',
      header: 'Action',
      render: (row) => <ReviewLink requestId={row.requestId} who={`${row.identifierType} flag`} />,
    },
  ];
  return (
    <ListStates
      result={result}
      caption="Duplicate identity flags"
      noun="the duplicate flags"
      emptyTitle="No duplicate flags"
      emptyBody="No identifier has been claimed by two accounts."
      failedTitle="We could not load the flags"
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
    />
  );
}

export function PeopleQueue({ view = 'queue' }: { view?: 'queue' | 'flags' }): React.JSX.Element {
  const { permissions } = useStaffViewer();
  const flags = view === 'flags';
  const allowed = permissions.has(flags ? 'duplicate_flag.view' : 'verification.view');

  let body: React.ReactNode;
  if (!allowed) {
    body = (
      <EmptyState
        title={
          flags
            ? 'Duplicate flags are not part of your role'
            : 'The verification queue is not part of your role'
        }
        body="Your role does not include this view. If you need it, ask your team lead to review your access."
      />
    );
  } else {
    body = flags ? <Flags /> : <Queue />;
  }

  return (
    <IdentityFrame
      tab={flags ? '/identity/flags' : '/identity'}
      title="People"
      description="Individuals and businesses waiting to be verified."
    >
      {body}
    </IdentityFrame>
  );
}
