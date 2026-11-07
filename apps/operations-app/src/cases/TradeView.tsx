'use client';

// OP-12 Trade 360, as far as the platform lets it be drawn today: every case opened on one Trade, and
// the Trust Trail of each. The reference also draws the Trade's stages, parties, money and parcel;
// there is no staff read for a Trade yet, and those panels would be invented, so they are left out.
//
// Cases are found by `subjectType = TRADE` and the trade reference as `subjectId`; an owning module
// that registers a Trade case has to use that pair for it to appear here.
import { TrustTrail } from '@komtru/ui-kit';
import { ConsoleFrame } from '../shell/ConsoleFrame';
import { trailLabel, whenLabel } from './format';
import { useCaseList, useCaseTrail } from './hooks';
import { caseColumns, CaseListView } from './shared';

export const TRADE_SUBJECT_TYPE = 'TRADE';

function CaseTrail({ caseId, heading }: { caseId: string; heading: string }): React.JSX.Element {
  const trail = useCaseTrail(caseId);
  const events =
    trail.data?.items.map((entry) => ({
      id: String(entry.id),
      title: trailLabel(entry.type),
      detail: [entry.reason, whenLabel(entry.occurredAt)].filter(Boolean).join(' · '),
    })) ?? [];
  return (
    <TrustTrail
      heading={heading}
      events={events}
      empty={trail.isError ? 'The Trust Trail did not load.' : trail.isPending ? 'Loading…' : undefined}
    />
  );
}

export function TradeView({ reference }: { reference: string }): React.JSX.Element {
  const result = useCaseList({ subjectType: TRADE_SUBJECT_TYPE, subjectId: reference });

  return (
    <ConsoleFrame
      current="trades"
      title={`Trade · ${reference}`}
      description="Every case opened on this Trade, with its Trust Trail."
    >
      <h2 className="mb-[10px] text-[14px] font-semibold">Where it is</h2>
      <CaseListView
        result={result}
        caption="Cases on this Trade"
        columns={caseColumns(['case', 'type', 'what', 'state', 'owner', 'clock'], undefined)}
        emptyTitle="No cases on this Trade"
        emptyBody="A case appears here when a dispute, review or exception is opened on it."
      />

      {result.cases.length > 0 && (
        <div className="mt-[24px] grid gap-[16px]">
          <h2 className="m-0 text-[14px] font-semibold">Everything that happened</h2>
          {result.cases.map((row) => (
            <CaseTrail
              key={row.id}
              caseId={row.id}
              heading={result.cases.length === 1 ? 'Trust Trail' : `Trust Trail · ${row.code}`}
            />
          ))}
        </div>
      )}
    </ConsoleFrame>
  );
}
