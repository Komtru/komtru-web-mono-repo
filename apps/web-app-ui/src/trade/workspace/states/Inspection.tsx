'use client';

import { useInspection } from '@komtru/api-client/react';
import { ActionStack, Button, SectionLabel, TermList, TermRow } from '@komtru/ui-kit';
import { hoursLabel, whenLabel } from '../../format';
import { extensionPending, releasePaused, stateCopy } from '../../workspace-copy';
import { inspectHref } from '../../workspace-state';
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
      {role === 'BUYER' && (
        <ActionStack>
          <Button asChild>
            <a href={inspectHref(trade.id)}>Inspect & confirm</a>
          </Button>
        </ActionStack>
      )}
      {role === 'SELLER' && data?.canRespondToRequest === true && (
        <ActionStack>
          <Button asChild>
            <a href={inspectHref(trade.id)}>Answer the request</a>
          </Button>
        </ActionStack>
      )}
      {copy.seam !== undefined && <NotInTheAppYet>{copy.seam}</NotInTheAppYet>}
      <FurtherViews trade={trade} />
    </>
  );
}
