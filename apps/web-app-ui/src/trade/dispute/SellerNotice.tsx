'use client';

// Seller-7 — "Dispute Notice". Constitutional Principle VIII: neutral, not accusatory.
//
// The buyer's words are quoted, attributed and kept apart from the platform's own voice. The
// screen never editorialises about them and never takes a side; what it says in its own voice is
// that responding is the seller's turn, and that the money is safe either way.
import type { DisputeDetail, TradeView } from '@komtru/api-client';
import { ActionStack, Button, ItemCard, SectionLabel } from '@komtru/ui-kit';
import { Frame, TradeGate } from '../delivery/parts';
import { naira, partyName } from '../format';
import { DisputeCountdown, DisputeGate } from './parts';
import { respondHref, tradeHref } from './routes';
import { reasonLabel } from './words';

const TITLE = 'Dispute';

export function SellerNotice({ id, disputeId }: { id: string; disputeId?: string }): React.JSX.Element {
  return (
    <TradeGate
      id={id}
      title={TITLE}
      role="SELLER"
      deniedWhy="This is the seller's view of the case. Open the case from your own side of the trade."
    >
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
  const buyer = trade.counterparty ? partyName(trade.counterparty) : 'The buyer';
  return (
    <Frame title={`${TITLE} · ${dispute.code}`} id={id}>
      <DisputeCountdown dispute={dispute} />

      <ItemCard
        title={trade.tradeCode}
        sub={`${naira(dispute.totalEscrowMinor)} · ${buyer}`}
        price={naira(dispute.totalEscrowMinor)}
      />

      <SectionLabel>Buyer’s reported issue</SectionLabel>
      <blockquote className="mb-[14px] rounded-md border border-solid border-border-hairline bg-surface-primary p-[12px] text-[12.5px] leading-[1.6] text-slate">
        “{dispute.openedReason}” — reason: {reasonLabel(dispute.category).toLowerCase()}
      </blockquote>

      <p className="mb-[4px] text-[11.5px] leading-[1.55] text-slate">
        This isn’t a penalty — it’s a chance to respond with your side before TrustOps decides. Responding
        quickly and clearly is itself part of your Trust Profile.
      </p>

      <ActionStack>
        <Button asChild>
          <a href={respondHref(id)}>Respond with evidence</a>
        </Button>
        <Button asChild variant="secondary">
          <a href={tradeHref(id)}>Back to the trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
