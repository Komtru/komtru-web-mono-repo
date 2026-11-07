'use client';

// OP-04 Alerts and escalations.
//
// The platform has no alert inbox, "mark read" or routing-rule store yet. What it does know is which
// cases are escalated and which have a clock at risk, so those are the alerts, and the rules shown
// are the ones the queue really applies (cases T-107, owner decision 2). The reference's rules about
// payout approvers and tampered parcels belong to the money and custody tickets that enforce them.
import { DataTable } from '@komtru/ui-kit';
import { useCaseQueue } from './hooks';
import { caseColumns, CaseListView, QueueFrame, useViewerId } from './shared';

const RULES = [
  {
    when: 'A clock is in the last quarter of its window',
    then: 'The case is marked at risk and listed here',
  },
  {
    when: 'A clock runs out',
    then: 'The clock reads Overdue and the case stays listed here until it is decided',
  },
  {
    when: 'A case is escalated',
    then: 'It is listed under Escalated for an expert decision, with the reason on its Trust Trail',
  },
] as const;

export function Alerts(): React.JSX.Element {
  const viewerId = useViewerId();
  const escalated = useCaseQueue('escalated');
  const atRisk = useCaseQueue('sla_at_risk');

  return (
    <QueueFrame
      tab="/queue/alerts"
      title="Alerts & escalations"
      description="Cases that need attention now, and the rules that put them here."
    >
      <h2 className="mb-[10px] text-[14px] font-semibold">Escalated</h2>
      <CaseListView
        result={escalated}
        caption="Escalated"
        columns={caseColumns(['case', 'area', 'what', 'owner', 'clock'], viewerId)}
        emptyTitle="Nothing escalated"
        emptyBody="Cases someone escalated for an expert decision appear here."
      />

      <h2 className="mb-[10px] mt-[24px] text-[14px] font-semibold">Clock at risk</h2>
      <CaseListView
        result={atRisk}
        caption="Clock at risk"
        columns={caseColumns(['case', 'area', 'what', 'owner', 'clock'], viewerId)}
        emptyTitle="No clocks at risk"
        emptyBody="Every open case is comfortably inside its window."
      />

      <h2 className="mb-[10px] mt-[24px] text-[14px] font-semibold">How the queue flags work</h2>
      <DataTable
        caption="Queue flag rules"
        rows={RULES}
        rowKey={(rule) => rule.when}
        columns={[
          { key: 'when', header: 'When', render: (rule) => rule.when },
          { key: 'then', header: 'Then', render: (rule) => rule.then },
        ]}
      />
    </QueueFrame>
  );
}
