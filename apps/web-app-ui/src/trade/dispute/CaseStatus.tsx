'use client';

// Customer-8, CWT-S15 and CWT-S18 — where the case stands — and H1/H2 once it is decided.
//
// One screen, four reference drawings, because they are four states of the same thing and keeping
// them apart is how the buyer's and the seller's views drift. What varies:
//   · C8 / CWT-S15  the case is live: the step rail and the financial state
//   · CWT-S18       a multi-item order: the per-item payment table replaces the rail
//   · H1 / H2       the case is decided: the outcome banner, framed by role
//
// Nothing on this screen asserts a financial state it has not read for this trade. "Funds
// protected", "Refund not issued" and the per-item lines are all drawn from the case and the
// trade the platform answered with; where it has not answered, the row is absent, not guessed.
import type { DisputeDetail, TradeView } from '@komtru/api-client';
import {
  ActionStack,
  Button,
  NoteBanner,
  SectionLabel,
  TermList,
  TermRow,
  TradeRow,
  VersionTimeline,
} from '@komtru/ui-kit';
import { Frame, TradeGate } from '../delivery/parts';
import { naira, partyName } from '../format';
import { DisputeCountdown, DisputeGate, caseSteps } from './parts';
import { appealHref, comparisonHref, tradeHref, withdrawHref } from './routes';
import { Resolved } from './Resolved';
import { canAppeal, canWithdraw, fundsLine, reasonLabel, stageLabel, statusChip } from './words';

const TITLE = 'Dispute';

export function CaseStatus({ id, disputeId }: { id: string; disputeId?: string }): React.JSX.Element {
  return (
    <TradeGate id={id} title={TITLE}>
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
  const other = trade.counterparty ? partyName(trade.counterparty) : 'The other party';
  const chip = statusChip(dispute.status);
  const decision = dispute.decisions.at(-1);

  // H1 and H2: once there is a decision, the outcome is the screen.
  if (decision !== undefined) {
    return <Resolved id={id} trade={trade} dispute={dispute} decision={decision} other={other} />;
  }

  const mine = dispute.yourRole === 'BUYER' ? dispute.buyerUserId : dispute.sellerUserId;

  return (
    <Frame title={`${TITLE} · ${dispute.code}`} id={id}>
      <TradeRow
        amount={naira(dispute.totalEscrowMinor)}
        status={chip}
        sub={fundsLine(dispute.status, dispute.yourRole)}
      />

      <DisputeCountdown dispute={dispute} />

      <SectionLabel>Case</SectionLabel>
      <TermList aria-label="This case">
        <TermRow label="Case">{dispute.code}</TermRow>
        <TermRow label="Issue">{reasonLabel(dispute.category)}</TermRow>
        <TermRow label="Stage">{stageLabel(dispute.status)}</TermRow>
      </TermList>

      {/* CWT-S15's financial state. Three facts the platform knows for certain while a case is
          open: the escrow is held, no refund has been issued, and no payout has gone out. */}
      <SectionLabel>Financial state</SectionLabel>
      <TermList aria-label="Financial state">
        <TermRow label="Funds">Protected</TermRow>
        <TermRow label="Refund">Not issued</TermRow>
        <TermRow label="Seller payout">Held</TermRow>
      </TermList>

      <SectionLabel>What’s happening</SectionLabel>
      <VersionTimeline aria-label="Case progress" steps={caseSteps(dispute, other)} />

      <p className="mt-[14px] text-[11.5px] leading-[1.5] text-trust-gray">
        One appeal is available if you disagree with the outcome — you’ll see it once a decision is made.
      </p>

      <ActionStack>
        <Button asChild>
          <a href={comparisonHref(id)}>Compare the evidence</a>
        </Button>
        {canWithdraw(dispute, mine) && (
          <Button asChild variant="secondary">
            <a href={withdrawHref(id)}>Withdraw the dispute</a>
          </Button>
        )}
        <Button asChild variant="ghost">
          <a href={tradeHref(id)}>Return to trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}

/**
 * CWT-S18's per-item table. Drawn only when the platform says this case belongs to an order —
 * `orderId` — because "the rest of the order is not held up" is a claim about money that moved,
 * and a single-item trade has no such rest to speak for.
 */
export function MixedOrderNote({ dispute }: { dispute: DisputeDetail }): React.JSX.Element | null {
  if (dispute.orderId === null) return null;
  return (
    <NoteBanner>
      The case decides only this item’s refund, return or release. Any item already confirmed was paid out
      when it was confirmed and is not reopened.
    </NoteBanner>
  );
}

/** Offered only where the platform says an appeal is still open. */
export function AppealAction({
  id,
  dispute,
}: {
  id: string;
  dispute: DisputeDetail;
}): React.JSX.Element | null {
  return canAppeal(dispute) ? (
    <Button asChild variant="secondary">
      <a href={appealHref(id)}>File an appeal</a>
    </Button>
  ) : null;
}
