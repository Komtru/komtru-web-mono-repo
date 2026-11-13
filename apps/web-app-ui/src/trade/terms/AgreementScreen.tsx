'use client';

import type { TradeView } from '@komtru/api-client';
import {
  ActionStack,
  Button,
  EmptyState,
  NoteBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  TermList,
  TermRow,
} from '@komtru/ui-kit';
import { addressLine, hoursLabel, naira } from '../format';
import { readRequest } from '../create/read';
import { ItemSummary, PartyHeader } from '../parts';
import { tabHref } from '../workspace-state';
import { historyHref } from './routes';
import { TradeFrame } from './TradeFrame';

/** What the trade has nothing agreed to show for: a proposal still being answered, or one that ended unaccepted. */
export function NothingAgreed({ trade }: { trade: TradeView }): React.JSX.Element {
  return (
    <ScreenColumn>
      <EmptyState
        title="Nothing has been agreed yet"
        body="The agreement appears here once both of you have accepted the same terms."
        action={
          <Button asChild variant="secondary">
            <a href={`/trade/${trade.id}`}>Back to the trade</a>
          </Button>
        }
      />
    </ScreenColumn>
  );
}

/** The delivery row's words: how it goes, from the terms' own item specification. */
export function deliveryWords(trade: TradeView): string {
  const reading = readRequest(trade);
  if (reading.mode === 'PARK') return `Park · ${reading.parkName ?? 'the chosen Park'}`;
  const charge = reading.deliveryChargeMinor;
  const to =
    trade.terms?.deliveryAddress === null || trade.terms?.deliveryAddress === undefined
      ? undefined
      : addressLine(trade.terms.deliveryAddress);
  if (reading.mode === 'COURIER') {
    return ['Courier', charge === undefined ? undefined : naira(charge)].filter(Boolean).join(' · ');
  }
  return to ?? 'To be arranged';
}

/** CWT-S01: the agreed version is the reference for fulfilment, inspection and any later dispute. */
export function AgreementScreen({ id }: { id: string }): React.JSX.Element {
  return (
    <TradeFrame id={id} title="Agreed Terms" loading="the agreement" back={`/trade/${id}`}>
      {(trade) => {
        if (trade.terms === null || trade.acceptedAt === null) return <NothingAgreed trade={trade} />;
        const { terms } = trade;
        return (
          <ScreenColumn>
            <ScreenHeader
              title="Agreed Terms"
              backHref={tabHref(trade.id, 'overview')}
              backLabel="Back to the trade"
            />
            <p className="mb-[14px] text-[12.5px] leading-[1.6] text-slate">
              Version {String(terms.versionNumber)} is the authoritative agreement for this trade.
            </p>
            <ItemSummary trade={trade} />
            <PartyHeader trade={trade} />
            <SectionLabel>Commercial terms</SectionLabel>
            <TermList aria-label="Commercial terms">
              <TermRow label="Price" checked>
                {naira(terms.itemAmountMinor)}
              </TermRow>
              <TermRow label="Delivery" checked>
                {deliveryWords(trade)}
              </TermRow>
              <TermRow label="Inspection" checked>
                {hoursLabel(terms.inspectionWindowHours)} minimum
              </TermRow>
            </TermList>
            <NoteBanner>
              Accepted terms are locked. Later fulfilment and payment events update status; they do not
              silently change the agreement.
            </NoteBanner>
            <ActionStack>
              <Button asChild>
                <a href={tabHref(trade.id, 'overview')}>Back to trade</a>
              </Button>
              <Button asChild variant="secondary">
                <a href={historyHref(trade.id)}>Version history</a>
              </Button>
            </ActionStack>
          </ScreenColumn>
        );
      }}
    </TradeFrame>
  );
}
