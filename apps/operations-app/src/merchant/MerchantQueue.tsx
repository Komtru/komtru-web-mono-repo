'use client';

// The merchant application queue (T-154): the Fraud Signals data-table pattern, with the clock first.
//
// Sorted by SLA risk by the platform (the case whose clock runs out first is the top row) and
// filterable by status and category. The chip counts a reference might draw ("Awaiting review (7)") need
// totals per status that the queue does not return, so the chips carry none; the one number the
// platform does answer, how many await a person, is on the sidebar item.
import type { MerchantApplicationStatus, MerchantQueueItem } from '@komtru/api-client';
import { Chip, EmptyState, FilterBar, Select, type DataColumn } from '@komtru/ui-kit';
import Link from 'next/link';
import { useState } from 'react';
import { humanise } from '../cases/format';
import { ListStates } from '../identity/PeopleQueue';
import { dueLabel } from '../identity/format';
import { useStaffViewer } from '../shell/viewer';
import { businessLabel, businessTypeLabel, statusLabel, statusTone, submittedLabel } from './format';
import { useMerchantCategories, useMerchantQueue } from './hooks';
import { MerchantFrame, merchantHref } from './shared';

type Filter = 'open' | MerchantApplicationStatus;

const CHIPS: readonly { id: Filter; label: string }[] = [
  { id: 'open', label: 'Awaiting review' },
  { id: 'SUBMITTED', label: 'Not yet taken' },
  { id: 'IN_REVIEW', label: 'In review' },
  { id: 'CHANGES_REQUESTED', label: 'Changes requested' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REJECTED', label: 'Rejected' },
];

function ReviewLink({ item }: { item: MerchantQueueItem }): React.JSX.Element {
  return (
    <Link
      href={merchantHref(item.applicationId)}
      aria-label={`Review ${businessLabel(item.businessName)} ${item.caseNumber}`}
      className="inline-block rounded-md border-[1.5px] border-solid border-border-hairline bg-surface-elevated px-[20px] py-[10px] text-[13px] font-semibold text-midnight-text"
    >
      Review
    </Link>
  );
}

function Queue(): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('open');
  const [category, setCategory] = useState('');
  const categories = useMerchantCategories(true);
  const result = useMerchantQueue(
    filter === 'open' ? undefined : filter,
    category === '' ? undefined : category,
    true,
  );
  const now = new Date();

  const columns: DataColumn<MerchantQueueItem>[] = [
    {
      key: 'business',
      header: 'Business',
      render: (row) => (
        <>
          <b>{businessLabel(row.businessName)}</b>
          <div className="font-mono text-[11px] text-slate">
            {row.caseNumber} · {row.applicantPublicId}
            {row.submissionCount > 1 ? ` · submission ${row.submissionCount}` : ''}
          </div>
        </>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => (
        <Chip tone="verified" dot={false}>
          {businessTypeLabel(row.businessType)}
        </Chip>
      ),
    },
    {
      key: 'categories',
      header: 'Categories',
      render: (row) => (
        <span className="text-[12px]">{row.categories.map((code) => humanise(code)).join(', ') || '—'}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Chip tone={statusTone(row.status)}>{statusLabel(row.status)}</Chip>,
    },
    {
      key: 'clock',
      header: 'Clock',
      render: (row) => {
        // A decided application's clock has stopped; saying "Overdue" about it would be false.
        if (row.caseState === 'DECIDED' || row.caseState === 'CLOSED' || row.status === 'CHANGES_REQUESTED') {
          return <span className="font-mono text-[12px] text-slate">Stopped</span>;
        }
        const due = dueLabel(row.slaDueAt, now);
        return (
          <span
            className={
              due.overdue
                ? 'font-mono text-[12px] font-semibold text-risk-on-soft'
                : 'font-mono text-[12px] font-semibold text-success-on-soft'
            }
          >
            {due.label}
          </span>
        );
      },
    },
    {
      key: 'waiting',
      header: 'Waiting',
      render: (row) => <span className="font-mono text-[12px]">{submittedLabel(row.submittedAt, now)}</span>,
    },
    { key: 'review', header: 'Action', render: (row) => <ReviewLink item={row} /> },
  ];

  return (
    <>
      <FilterBar
        label="Show"
        chips={CHIPS.map((chip) => ({ id: chip.id, label: chip.label, active: filter === chip.id }))}
        onChipToggle={(id) => setFilter(id as Filter)}
      >
        <Select
          label="Category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          options={[
            { value: '', label: 'All categories' },
            ...(categories.data ?? []).map((entry) => ({ value: entry.code, label: entry.name })),
          ]}
        />
      </FilterBar>
      <ListStates
        result={result}
        caption="Merchant applications"
        noun="the merchant applications"
        emptyTitle="No applications here"
        emptyBody={
          filter === 'open' && category === ''
            ? 'Nothing is waiting for a decision right now. New applications appear here as soon as they are submitted.'
            : 'No application matches these filters.'
        }
        failedTitle="We could not load the applications"
        rows={result.rows}
        columns={columns}
        rowKey={(row) => row.applicationId}
      />
    </>
  );
}

export function MerchantQueue(): React.JSX.Element {
  const { permissions } = useStaffViewer();
  return (
    <MerchantFrame
      title="Merchant Applications"
      description="People applying to sell as certified merchants, with the clock that runs on each."
    >
      {permissions.has('merchant.application.view') ? (
        <Queue />
      ) : (
        <EmptyState
          title="Merchant applications are not part of your role"
          body="Your role does not include this view. If you need it, ask your team lead to review your access."
        />
      )}
    </MerchantFrame>
  );
}
