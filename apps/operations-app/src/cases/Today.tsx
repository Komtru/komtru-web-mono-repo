'use client';

// OP-01 Today: what is waiting, what to do first, and what has been escalated.
//
// Left out because the platform has no read for them: "Decided today" and "Just decided" (no
// recent-decisions feed) and "Where the work is" (no per-area totals or oldest-clock figures).
// Drawing them from invented rows would be worse than not drawing them.
import { KpiCard } from '@komtru/ui-kit';
import Link from 'next/link';
import { caseColumns, CaseListView, QueueFrame, useViewerId } from './shared';
import { useCaseCounts, useCaseQueue } from './hooks';

function Heading({ children, action }: { children: string; action?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-[10px] mt-[24px] flex items-baseline justify-between gap-[10px]">
      <h2 className="m-0 text-[14px] font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function Today(): React.JSX.Element {
  const viewerId = useViewerId();
  const counts = useCaseCounts();
  const mine = useCaseQueue('mine');
  const escalated = useCaseQueue('escalated');
  const data = counts.data;

  return (
    <QueueFrame
      tab="/queue"
      title="Today"
      description="What is waiting for you, where the work is and what is escalated."
    >
      <section aria-label="Queue at a glance" className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
        <KpiCard
          label="Waiting for you"
          value={data === undefined ? '–' : String(data.mine)}
          {...(data !== undefined && data.mineUrgent > 0
            ? { trend: { text: `${data.mineUrgent} urgent`, tone: 'flag' as const } }
            : {})}
        />
        <KpiCard label="Team open" value={data === undefined ? '–' : String(data.unassigned)} />
        <KpiCard label="Escalated" value={data === undefined ? '–' : String(data.escalated)} />
        <KpiCard
          label="Clock at risk"
          value={data === undefined ? '–' : String(data.slaAtRisk)}
          {...(data !== undefined && data.slaAtRisk > 0
            ? { trend: { text: 'in the last quarter or overdue', tone: 'flag' as const } }
            : {})}
        />
      </section>

      <Heading
        action={
          <Link href="/queue/mine" className="text-[12px] font-semibold text-info-on-soft">
            My work
          </Link>
        }
      >
        Do these first
      </Heading>
      <CaseListView
        result={mine}
        caption="Do these first"
        columns={caseColumns(['case', 'what', 'clock'], viewerId)}
        emptyTitle="Nothing waiting for you"
        emptyBody="Cases you own appear here, most urgent first. Take one from the team queue."
        limit={5}
      />

      <Heading
        action={
          <Link href="/queue/alerts" className="text-[12px] font-semibold text-info-on-soft">
            View all
          </Link>
        }
      >
        Escalated
      </Heading>
      <CaseListView
        result={escalated}
        caption="Escalated"
        columns={caseColumns(['case', 'what', 'owner', 'clock'], viewerId)}
        emptyTitle="Nothing escalated"
        emptyBody="Cases someone escalated for an expert decision appear here."
        limit={5}
      />
    </QueueFrame>
  );
}
