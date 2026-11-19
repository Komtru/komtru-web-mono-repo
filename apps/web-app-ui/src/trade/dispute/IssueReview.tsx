'use client';

// DI-01 — "Report an Issue", the structured intake. The reference's own hand-off point: every
// other intake screen (CWT-S14, CWT-S17) says "Continue to issue review" and lands here, and this
// screen says "Continue to evidence" and lands on the evidence flow.
//
// By the time a person is here the case already exists — the previous screen opened it — so this
// screen reviews what was filed rather than asking again. That is a deliberate reading of the
// reference's graph: DI-01 sits between intake and evidence, and a second category picker at this
// point would be asking the same question twice and storing the second answer.
import type { DisputeDetail, TradeView } from '@komtru/api-client';
import { ActionStack, Button, ItemCard, NoteBanner, SectionLabel, TermList, TermRow } from '@komtru/ui-kit';
import { Frame, TradeGate } from '../delivery/parts';
import { naira } from '../format';
import { DisputeGate } from './parts';
import { comparisonHref, disputeStatusHref } from './routes';
import { INTAKE_NOTE, reasonLabel } from './words';

const TITLE = 'Report an Issue';

export function IssueReview({ id, disputeId }: { id: string; disputeId?: string }): React.JSX.Element {
  return (
    <TradeGate id={id} title={TITLE} role="BUYER">
      {(trade) => (
        <DisputeGate id={id} disputeId={disputeId} title={TITLE}>
          {(dispute) => <Body id={id} trade={trade} dispute={dispute} />}
        </DisputeGate>
      )}
    </TradeGate>
  );
}

function Body({
  id,
  trade,
  dispute,
}: {
  id: string;
  trade: TradeView;
  dispute: DisputeDetail;
}): React.JSX.Element {
  return (
    <Frame title={TITLE} id={id}>
      <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
        Your report is linked to this trade and the evidence you provide.
      </p>

      <SectionLabel>Affected item</SectionLabel>
      <ItemCard
        title={trade.tradeCode}
        sub={dispute.orderId === null ? 'Entire order' : 'One item of this order'}
        price={naira(dispute.totalEscrowMinor)}
      />

      <SectionLabel>What you reported</SectionLabel>
      <TermList aria-label="What you reported">
        <TermRow label="Case">{dispute.code}</TermRow>
        <TermRow label="Issue">{reasonLabel(dispute.category)}</TermRow>
      </TermList>
      <blockquote className="mb-[14px] rounded-md border border-solid border-border-hairline bg-surface-primary p-[12px] text-[12.5px] leading-[1.6] text-slate">
        {dispute.openedReason}
      </blockquote>

      <NoteBanner>{INTAKE_NOTE}</NoteBanner>

      <ActionStack>
        <Button asChild>
          <a href={comparisonHref(id)}>Continue to evidence</a>
        </Button>
        <Button asChild variant="secondary">
          <a href={disputeStatusHref(id)}>See where the case stands</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
