'use client';

// The pieces every work-queue screen shares: the frame with its tab strip, the case table and the
// loading / empty / failed states of a list.
import type { CaseView } from '@komtru/api-client';
import { Button, Chip, DataTable, EmptyState, Skeleton, type DataColumn } from '@komtru/ui-kit';
import Link from 'next/link';
import { ConsoleFrame } from '../shell/ConsoleFrame';
import { useStaffViewer } from '../shell/viewer';
import { areaOf, clockLabel, clockTone, ownerLabel, priorityLabel, stateLabel, typeLabel } from './format';
import type { CaseListResult } from './hooks';

export const QUEUE_TABS = [
  { href: '/queue', label: 'Today' },
  { href: '/queue/mine', label: 'My work' },
  { href: '/queue/team', label: 'Team queue' },
  { href: '/queue/alerts', label: 'Alerts' },
  { href: '/queue/cases', label: 'Cases' },
] as const;

export const caseHref = (id: string): string => `/queue/cases/${id}`;

function Tabs({ current }: { current: string }): React.JSX.Element {
  return (
    <nav aria-label="Work queue views" className="mb-[16px] flex flex-wrap gap-[6px]">
      {QUEUE_TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          {...(tab.href === current ? { 'aria-current': 'page' as const } : {})}
          className={
            tab.href === current
              ? 'rounded-full border-[1.5px] border-solid border-trust-indigo bg-trust-indigo-soft px-[12px] py-[7px] text-[12px] font-semibold text-info-on-soft'
              : 'rounded-full border-[1.5px] border-solid border-border-hairline bg-surface-elevated px-[12px] py-[7px] text-[12px] font-semibold text-midnight-text'
          }
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export interface QueueFrameProps {
  tab: (typeof QUEUE_TABS)[number]['href'] | null;
  title: string;
  description?: string;
  children: React.ReactNode;
}

/** The Work Queue section's chrome: the console frame, then the five views as a strip of links. */
export function QueueFrame({ tab, title, description, children }: QueueFrameProps): React.JSX.Element {
  return (
    <ConsoleFrame current="queue" title={title} {...(description === undefined ? {} : { description })}>
      {tab !== null && <Tabs current={tab} />}
      {children}
    </ConsoleFrame>
  );
}

export function ClockChip({ sla }: { sla: CaseView['sla'] }): React.JSX.Element {
  const tone = clockTone(sla);
  const label = clockLabel(sla);
  return tone === undefined ? (
    <span className="font-mono text-[12px]">{label}</span>
  ) : (
    <Chip tone={tone}>{label}</Chip>
  );
}

export const CaseLink = ({ row }: { row: CaseView }): React.JSX.Element => (
  <Link href={caseHref(row.id)} className="font-mono text-[12px] font-semibold text-info-on-soft">
    {row.code}
  </Link>
);

export type ColumnKey = 'case' | 'area' | 'type' | 'what' | 'state' | 'priority' | 'owner' | 'clock';

export function caseColumns(
  keys: readonly ColumnKey[],
  viewerId: string | undefined,
  extra?: DataColumn<CaseView>,
): DataColumn<CaseView>[] {
  const all: Record<ColumnKey, DataColumn<CaseView>> = {
    case: {
      key: 'case',
      header: 'Case',
      render: (row) => (
        <>
          <CaseLink row={row} />
          <div className="text-[11px] text-slate">{row.subjectId}</div>
        </>
      ),
    },
    area: { key: 'area', header: 'Area', render: (row) => areaOf(row.type) },
    type: { key: 'type', header: 'Type', render: (row) => typeLabel(row.type) },
    what: { key: 'what', header: 'What', render: (row) => row.title },
    state: { key: 'state', header: 'State', render: (row) => stateLabel(row.state) },
    priority: { key: 'priority', header: 'Priority', render: (row) => priorityLabel(row.priority) },
    owner: { key: 'owner', header: 'Owner', render: (row) => ownerLabel(row.ownerUserId, viewerId) },
    clock: { key: 'clock', header: 'Clock', render: (row) => <ClockChip sla={row.sla} /> },
  };
  const columns = keys.map((key) => all[key]);
  return extra === undefined ? columns : [...columns, extra];
}

export interface CaseListViewProps {
  result: CaseListResult;
  caption: string;
  columns: readonly DataColumn<CaseView>[];
  emptyTitle: string;
  emptyBody: string;
  /** Rows to show instead of all of them, for the short lists on Today. */
  limit?: number;
  /** Filters that are applied on the screen, after the platform's answer. */
  filter?: (row: CaseView) => boolean;
}

/** A case list with its three non-data states: loading, failed (with a way out) and empty. */
export function CaseListView({
  result,
  caption,
  columns,
  emptyTitle,
  emptyBody,
  limit,
  filter,
}: CaseListViewProps): React.JSX.Element {
  if (result.loading) {
    return (
      <div role="status" aria-label={`Loading ${caption}`} className="grid gap-[8px]">
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
        title="We could not load this list"
        body="The case list did not load. Try again, or check that your role can see cases."
        action={
          <Button type="button" onClick={result.retry} className="w-auto!">
            Try again
          </Button>
        }
      />
    );
  }
  const filtered = filter === undefined ? result.cases : result.cases.filter(filter);
  const rows = limit === undefined ? filtered : filtered.slice(0, limit);
  if (rows.length === 0 && !result.hasMore) {
    return <EmptyState title={emptyTitle} body={emptyBody} />;
  }
  return (
    <DataTable
      caption={caption}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      empty="Nothing in the cases loaded so far."
      footer={
        <>
          <span>
            Showing {rows.length}
            {result.hasMore ? ' so far' : ''}
          </span>
          {result.hasMore && limit === undefined && (
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

export const useViewerId = (): string | undefined => useStaffViewer().me?.user.id;

export const HAS_MANAGE = 'cases.manage' as const;
export const useCanManage = (): boolean => useStaffViewer().permissions.has(HAS_MANAGE);
