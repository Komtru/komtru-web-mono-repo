'use client';

// OP-03 Team queue: everything nobody owns yet, with "Take it".
//
// "Who has capacity" is not drawn: the platform has no staff roster, shift or open-count read, and a
// list of invented colleagues is worse than none. Assigning to someone else is Reassign on the case.
import { Banner, Button, type DataColumn } from '@komtru/ui-kit';
import { takeCase, type CaseView } from '@komtru/api-client';
import { useCaseAction, useCaseQueue } from './hooks';
import { caseColumns, CaseListView, QueueFrame, useCanManage, useViewerId } from './shared';

export function TeamQueue(): React.JSX.Element {
  const viewerId = useViewerId();
  const canManage = useCanManage();
  const result = useCaseQueue('unassigned');
  const take = useCaseAction((client, caseId: string) => client.call(takeCase, { params: { id: caseId } }));

  const takeColumn: DataColumn<CaseView> = {
    key: 'take',
    header: 'Action',
    render: (row) => (
      <Button
        type="button"
        variant="secondary"
        disabled={take.isPending}
        onClick={() => take.mutate(row.id)}
        className="w-auto!"
      >
        Take it<span className="sr-only"> {row.code}</span>
      </Button>
    ),
  };

  return (
    <QueueFrame
      tab="/queue/team"
      title="Team queue"
      description="Unassigned items. Take one, or open it to assign it to someone."
    >
      {take.isError && (
        <Banner tone="risk" title="We could not take that case" className="mb-[12px]">
          Someone may have taken it first. The list has been refreshed.
        </Banner>
      )}
      <CaseListView
        result={result}
        caption="Unassigned"
        columns={caseColumns(
          ['case', 'area', 'what', 'priority', 'clock'],
          viewerId,
          canManage ? takeColumn : undefined,
        )}
        emptyTitle="Nothing is waiting for an owner"
        emptyBody="When an owning area registers a case nobody holds, it appears here."
      />
    </QueueFrame>
  );
}
