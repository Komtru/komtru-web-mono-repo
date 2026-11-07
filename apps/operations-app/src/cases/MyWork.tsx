'use client';

// OP-02 My work: everything assigned to the signed-in person, across every area, with the clock.
// The area chips narrow the cases already loaded; the platform's queue filters by type, not by area.
import { FilterBar, type FilterChip } from '@komtru/ui-kit';
import { useState } from 'react';
import { AREAS, areaOf, type Area } from './format';
import { useCaseQueue } from './hooks';
import { caseColumns, CaseListView, QueueFrame, useViewerId } from './shared';

export function MyWork(): React.JSX.Element {
  const viewerId = useViewerId();
  const result = useCaseQueue('mine');
  const [area, setArea] = useState<Area | null>(null);

  const present = AREAS.filter((candidate) => result.cases.some((row) => areaOf(row.type) === candidate));
  const chips: FilterChip[] = [
    { id: 'all', label: `All (${result.cases.length})`, active: area === null },
    ...present.map((candidate) => ({ id: candidate, label: candidate, active: area === candidate })),
  ];

  return (
    <QueueFrame
      tab="/queue/mine"
      title="My work"
      description="Everything assigned to you, most urgent first."
    >
      <FilterBar
        label="Area"
        chips={chips}
        onChipToggle={(chipId) => setArea(chipId === 'all' || chipId === area ? null : (chipId as Area))}
      />
      <CaseListView
        result={result}
        caption="My work"
        columns={caseColumns(['case', 'area', 'what', 'priority', 'clock'], viewerId)}
        emptyTitle="Nothing waiting for you"
        emptyBody="Cases you take from the team queue appear here."
        {...(area === null ? {} : { filter: (row) => areaOf(row.type) === area })}
      />
    </QueueFrame>
  );
}
