'use client';

// OP-19 Cases: every case in one list, filterable by type and findable by case number.
// The reference's four summary tiles (open, disputes, appeals, risk) need totals the platform does
// not return; they would have to be counted from a partial page, so they are not drawn.
import type { CaseType } from '@komtru/api-client';
import { FilterBar, type FilterChip } from '@komtru/ui-kit';
import { useEffect, useState } from 'react';
import { useCaseList } from './hooks';
import { caseColumns, CaseListView, QueueFrame, useViewerId } from './shared';

const TYPE_CHIPS: readonly { type: CaseType; label: string }[] = [
  { type: 'DISPUTE', label: 'Disputes' },
  { type: 'FRAUD', label: 'Risk' },
  { type: 'TRADE_PROPOSAL', label: 'Proposals' },
  { type: 'PAYMENT_EXCEPTION', label: 'Money' },
  { type: 'CUSTODY', label: 'Custody' },
  { type: 'IDENTITY', label: 'Identity' },
  { type: 'KYB', label: 'Business checks' },
  { type: 'MERCHANT_APPLICATION', label: 'Merchants' },
  { type: 'PARK_HUB_APPLICATION', label: 'Park hubs' },
];

const DEBOUNCE_MS = 300;

export function CasesList(): React.JSX.Element {
  const viewerId = useViewerId();
  const [type, setType] = useState<CaseType | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');

  // The platform takes at most 20 characters of search; a keystroke is not a query.
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim().slice(0, 20)), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const result = useCaseList({ type, q });

  const chips: FilterChip[] = TYPE_CHIPS.map((chip) => ({
    id: chip.type,
    label: chip.label,
    active: type === chip.type,
  }));

  return (
    <QueueFrame
      tab="/queue/cases"
      title="Cases"
      description="Everything that needs a decision, with the clock that matters."
    >
      <FilterBar
        search={{
          label: 'Search by case number',
          placeholder: 'Search by case number, e.g. C-002841',
          value: search,
          onChange: setSearch,
        }}
        label="Case type"
        chips={chips}
        onChipToggle={(chipId) =>
          setType((current) => (current === chipId ? undefined : (chipId as CaseType)))
        }
      />
      <CaseListView
        result={result}
        caption="Cases"
        columns={caseColumns(['case', 'type', 'what', 'state', 'owner', 'clock'], viewerId)}
        emptyTitle="No cases match"
        emptyBody="Try another type, or clear the search."
      />
    </QueueFrame>
  );
}
