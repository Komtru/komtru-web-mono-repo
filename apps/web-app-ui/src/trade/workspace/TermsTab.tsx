'use client';

import type { TradeView } from '@komtru/api-client';
import { ActionStack, Button, ReadyBanner, SectionLabel, VersionTimeline } from '@komtru/ui-kit';
import { ItemSummary, PartyHeader, TermsRows, versionSteps } from '../parts';
import { tabHref } from '../workspace-state';
import { agreementHref, fulfilmentHref, historyHref } from '../terms/routes';
import { FeeList } from './shared';

/** CWT-07: the agreed version, which is the reference for fulfilment, inspection and any later dispute. */
export function TermsTab({ trade }: { trade: TradeView }): React.JSX.Element {
  return (
    <>
      <ReadyBanner title="Terms recorded">
        The accepted version is the reference for fulfilment, inspection and any later dispute.
      </ReadyBanner>
      <ItemSummary trade={trade} />
      <PartyHeader trade={trade} />
      <SectionLabel>Terms of this trade</SectionLabel>
      <TermsRows trade={trade} />
      <FeeList trade={trade} role={trade.yourRole} />
      <SectionLabel>Agreement history</SectionLabel>
      <VersionTimeline aria-label="Versions of this agreement" steps={versionSteps(trade)} />
      <ActionStack>
        <Button asChild variant="secondary">
          <a href={agreementHref(trade.id)}>View the agreement</a>
        </Button>
        <Button asChild variant="secondary">
          <a href={fulfilmentHref(trade.id)}>Fulfilment terms</a>
        </Button>
        <Button asChild variant="secondary">
          <a href={historyHref(trade.id)}>Version history</a>
        </Button>
        <Button asChild variant="secondary">
          <a href={tabHref(trade.id, 'overview')}>Back to overview</a>
        </Button>
      </ActionStack>
    </>
  );
}
