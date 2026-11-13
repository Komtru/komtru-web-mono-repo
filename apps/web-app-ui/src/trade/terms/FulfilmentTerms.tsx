'use client';

import { usePinnedStandard } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  NoteBanner,
  ReadyBanner,
  SectionLabel,
  TermList,
  TermRow,
} from '@komtru/ui-kit';
import { readRequest } from '../create/read';
import { addressLine, hoursLabel, naira } from '../format';
import { tabHref } from '../workspace-state';
import { NothingAgreed } from './AgreementScreen';
import { TradeFrame } from './TradeFrame';

/**
 * TW-02: what was agreed about getting the item there. The reference draws inputs that rebuild the summary;
 * a trade whose terms were accepted has none to rebuild (no route edits an accepted version, and a change before
 * acceptance is a counter), so every row is read from the accepted terms and nothing here can be edited.
 */
export function FulfilmentTerms({ id }: { id: string }): React.JSX.Element {
  return (
    <TradeFrame
      id={id}
      title="Fulfilment Terms"
      loading="the fulfilment terms"
      back={tabHref(id, 'overview')}
    >
      {(trade) => {
        if (trade.terms === null || trade.acceptedAt === null) return <NothingAgreed trade={trade} />;
        return <Body trade={trade} terms={trade.terms} />;
      }}
    </TradeFrame>
  );
}

function Body({
  trade,
  terms,
}: {
  trade: Parameters<typeof readRequest>[0];
  terms: NonNullable<Parameters<typeof readRequest>[0]['terms']>;
}): React.JSX.Element {
  const standard = usePinnedStandard(trade.standardVersionId);
  const reading = readRequest(trade);
  const park = reading.mode === 'PARK';
  const destination = park
    ? reading.parkName
    : terms.deliveryAddress === null
      ? undefined
      : addressLine(terms.deliveryAddress);
  const minimum = standard.data;
  return (
    <>
      {minimum !== undefined && (
        <ReadyBanner
          title={`${hoursLabel(minimum.inspectionWindowHours)} — ${minimum.categoryName} standard`}
        >
          Komtru&apos;s minimum for this category. Extensions are allowed, but never shorter than the minimum.
        </ReadyBanner>
      )}
      <SectionLabel>Agreed fulfilment terms</SectionLabel>
      <TermList aria-label="Fulfilment terms">
        {trade.categoryName !== null && <TermRow label="Product category">{trade.categoryName}</TermRow>}
        <TermRow label="Agreed inspection period">{hoursLabel(terms.inspectionWindowHours)}</TermRow>
        {reading.mode !== undefined && (
          <TermRow label="Delivery method">{park ? 'Park pickup' : 'Courier delivery'}</TermRow>
        )}
        {destination !== undefined && <TermRow label="Destination">{destination}</TermRow>}
        {reading.deliveryChargeMinor !== undefined && (
          <TermRow label="Courier charge">{naira(reading.deliveryChargeMinor)}</TermRow>
        )}
      </TermList>
      <NoteBanner>
        Accepted terms are locked. Later fulfilment and payment events update status; they do not silently
        change the agreement.
      </NoteBanner>
      <ActionStack>
        <Button asChild variant="secondary">
          <a href={tabHref(trade.id, 'overview')}>Back to the trade</a>
        </Button>
      </ActionStack>
    </>
  );
}
