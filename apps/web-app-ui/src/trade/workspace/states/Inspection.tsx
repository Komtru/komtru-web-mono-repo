'use client';

import { useInspection } from '@komtru/api-client/react';
import { SectionLabel, TermList, TermRow } from '@komtru/ui-kit';
import { hoursLabel, whenLabel } from '../../format';
import { extensionPending, releasePaused, stateCopy } from '../../workspace-copy';
import { BannerView, Deadline, FurtherViews, NotInTheAppYet, type BodyProps } from '../shared';

/** CWT-04: the buyer has the item and the clock is running. */
export function Inspection({ trade, role }: BodyProps): React.JSX.Element {
  const inspection = useInspection(trade.id, true);
  const copy = stateCopy('INSPECTION', role);
  const data = inspection.data;
  return (
    <>
      {copy.banner && <BannerView banner={copy.banner} />}
      {data?.window.autoReleasePaused === true && <BannerView banner={releasePaused} />}
      <Deadline
        label={copy.deadlineLabel ?? 'Inspection ends'}
        noun="inspection deadline"
        query={inspection}
        at={data?.window.deadlineAt}
      />
      {data !== undefined && (
        <>
          {data.extensionRequest?.status === 'PENDING' && <BannerView banner={extensionPending(role)} />}
          <SectionLabel>Inspection</SectionLabel>
          <TermList aria-label="Inspection window">
            {trade.categoryName !== null && <TermRow label="Category">{trade.categoryName}</TermRow>}
            <TermRow label="Window">{hoursLabel(data.window.hours)}</TermRow>
            {data.window.startedAt !== null && (
              <TermRow label="Started">{whenLabel(data.window.startedAt)}</TermRow>
            )}
            {data.window.deadlineAt !== null && (
              <TermRow label="Ends">
                {whenLabel(data.window.deadlineAt)}
                {data.window.extended ? ' · extended' : ''}
              </TermRow>
            )}
          </TermList>
        </>
      )}
      {/* SEAM(F-027): "Inspect & compare", accept and release, ask for more time, answer a request, report an issue. */}
      {copy.seam !== undefined && <NotInTheAppYet>{copy.seam}</NotInTheAppYet>}
      <FurtherViews trade={trade} />
    </>
  );
}
