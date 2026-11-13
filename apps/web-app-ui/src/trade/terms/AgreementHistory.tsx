'use client';

import {
  ActionStack,
  Button,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  TermList,
  TermRow,
  VersionTimeline,
} from '@komtru/ui-kit';
import { naira, whenLabel } from '../format';
import { versionSteps } from '../parts';
import { tabHref } from '../workspace-state';
import { NothingAgreed } from './AgreementScreen';
import { agreementHref } from './routes';
import { TradeFrame } from './TradeFrame';

/**
 * CWT-S02: earlier proposals stay visible. The platform returns only the accepted terms, so the versions before
 * them are listed as superseded without an amount or a proposer: nothing is drawn that the screen was not told.
 */
export function AgreementHistory({ id }: { id: string }): React.JSX.Element {
  return (
    <TradeFrame id={id} title="Agreement History" loading="the agreement history" back={`/trade/${id}`}>
      {(trade) => {
        if (trade.terms === null || trade.acceptedAt === null) return <NothingAgreed trade={trade} />;
        const steps = versionSteps(trade).map((step) =>
          step.state === 'done' && step.title.endsWith('Accepted') && trade.terms !== null
            ? { ...step, detail: `${naira(trade.terms.itemAmountMinor)} · accepted by buyer and seller` }
            : step,
        );
        return (
          <ScreenColumn>
            <ScreenHeader
              title="Agreement History"
              backHref={agreementHref(trade.id)}
              backLabel="Back to the agreement"
            />
            <p className="mb-[14px] text-[12.5px] leading-[1.6] text-slate">
              Earlier proposals remain visible without replacing the accepted version.
            </p>
            <VersionTimeline aria-label="Versions of this agreement" steps={steps} />
            <SectionLabel>Acceptance</SectionLabel>
            <TermList aria-label="Acceptance">
              <TermRow label="Accepted">{whenLabel(trade.acceptedAt)}</TermRow>
              <TermRow label="Trade">{trade.tradeCode}</TermRow>
            </TermList>
            <ActionStack>
              <Button asChild>
                <a href={agreementHref(trade.id)}>View accepted terms</a>
              </Button>
              <Button asChild variant="secondary">
                <a href={tabHref(trade.id, 'overview')}>Return to trade</a>
              </Button>
            </ActionStack>
          </ScreenColumn>
        );
      }}
    </TradeFrame>
  );
}
