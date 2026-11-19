'use client';

// Y1 — "Evidence Comparison", and Seller-8's "Submit Evidence" response, which is the same screen
// reached from the seller's side.
//
// The two panels are always both drawn, even when one is empty, and an empty one says "Nothing
// added yet" in so many words. That is not politeness: a comparison that silently omitted the
// empty side would read as "they submitted nothing", which is an accusation the screen has no
// business making — the truth may be that this trade never had dispatch photos at all.
//
// The desired-outcome picker is the mediation offer. The reference lists "Full refund with
// return", "Partial settlement" and "Replacement item"; only one of those is a money outcome the
// platform has. Return and replacement ride as the agreed note on the money outcome they imply
// (Q10: return shipping is self-arranged), which is exactly what the platform stores.
import { useState } from 'react';
import type { ComparisonPanel, DisputeDetail, EvidenceComparison as Comparison } from '@komtru/api-client';
import { useEvidenceComparison, useProposeSettlement } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  EmptyState,
  LoadingScreen,
  NoteBanner,
  SectionLabel,
  TextArea,
} from '@komtru/ui-kit';
import { Frame, ReadFailed, TradeGate } from '../delivery/parts';
import { problemMessage } from '../format';
import { DisputeCountdown, DisputeGate, ReasonChoice } from './parts';
import { disputeStatusHref, tradeHref } from './routes';

const TITLE = 'Evidence';

/**
 * The three the reference offers, each with the money outcome it really is. `note` is what the
 * platform records beside the amounts so the agreed arrangement survives as words.
 */
const DESIRED = [
  {
    id: 'REFUND_WITH_RETURN',
    label: 'Full refund with return',
    outcome: 'REFUND_BUYER_FULL' as const,
    note: 'Full refund; the item goes back, return shipping self-arranged.',
  },
  {
    id: 'PARTIAL',
    label: 'Partial settlement',
    outcome: 'REFUND_BUYER_PARTIAL' as const,
    note: null,
  },
  {
    id: 'REPLACEMENT',
    label: 'Replacement item',
    outcome: 'RELEASE_SELLER_FULL' as const,
    note: 'Seller sends a replacement; the payment is released once it arrives.',
  },
];

export function EvidenceComparison({ id, disputeId }: { id: string; disputeId?: string }): React.JSX.Element {
  return (
    <TradeGate id={id} title={TITLE}>
      {() => (
        <DisputeGate id={id} disputeId={disputeId} title={TITLE}>
          {(dispute) => <Body id={id} dispute={dispute} />}
        </DisputeGate>
      )}
    </TradeGate>
  );
}

function Body({ id, dispute }: { id: string; dispute: DisputeDetail }): React.JSX.Element {
  const comparison = useEvidenceComparison(dispute.id);

  if (comparison.isPending) {
    return (
      <Frame title={`${TITLE} · ${dispute.code}`} id={id}>
        <LoadingScreen label="Loading the evidence" />
      </Frame>
    );
  }
  if (comparison.isError) {
    return (
      <Frame title={`${TITLE} · ${dispute.code}`} id={id}>
        <ReadFailed error={comparison.error} noun="the evidence" onRetry={() => void comparison.refetch()} />
      </Frame>
    );
  }

  return <Loaded id={id} dispute={dispute} comparison={comparison.data} />;
}

function Loaded({
  id,
  dispute,
  comparison,
}: {
  id: string;
  dispute: DisputeDetail;
  comparison: Comparison;
}): React.JSX.Element {
  const [desired, setDesired] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const propose = useProposeSettlement();
  const open = dispute.status === 'MEDIATION';

  const submit = (): void => {
    const choice = DESIRED.find((option) => option.id === desired);
    if (choice === undefined || propose.isPending) return;
    if (choice.outcome === 'REFUND_BUYER_PARTIAL') return; // guarded by `ready` below
    const whole = dispute.totalEscrowMinor;
    propose.mutate(
      {
        disputeId: dispute.id,
        outcome: choice.outcome,
        amountToBuyerMinor: choice.outcome === 'REFUND_BUYER_FULL' ? whole : '0',
        amountToSellerMinor: choice.outcome === 'REFUND_BUYER_FULL' ? '0' : whole,
        ...(choice.note !== null || note.trim()
          ? { note: [choice.note, note.trim()].filter(Boolean).join(' ') }
          : {}),
      },
      {
        onSuccess: () => {
          window.location.assign(disputeStatusHref(id));
        },
      },
    );
  };

  // A partial settlement needs an amount, and no screen in this feature collects one: splitting
  // the escrow is F-034's job (Track C — mutual settlement). Offering the option and then
  // refusing it would be worse than saying so.
  const partial = desired === 'PARTIAL';
  const ready = desired !== null && !partial;

  return (
    <Frame title={`${TITLE} · ${dispute.code}`} id={id}>
      <DisputeCountdown dispute={dispute} />

      <SectionLabel>Compare what was promised vs. what arrived</SectionLabel>
      <div className="mb-[16px] grid grid-cols-2 gap-[10px]">
        <Panel title="Seller’s pre-shipment proof" panel={comparison.seller} />
        <Panel title="Buyer’s unboxing photos" panel={comparison.buyer} />
      </div>

      {comparison.custody.length > 0 && (
        <>
          <SectionLabel>Custody photos</SectionLabel>
          <p className="mb-[14px] text-[12px] text-slate">
            {comparison.custody.length} taken while the parcel was with a Park hub.
          </p>
        </>
      )}

      {open ? (
        <>
          <ReasonChoice
            legend="Desired outcome"
            name="desired-outcome"
            options={DESIRED.map((option) => ({ id: option.id, label: option.label }))}
            value={desired}
            onChange={setDesired}
          />

          {partial && (
            <NoteBanner>
              Settling on a part of the payment is agreed between you on the settlement screen, which isn’t in
              the app yet. Choose one of the other two here, or keep talking in the case.
            </NoteBanner>
          )}

          <TextArea
            label="Anything to add?"
            rows={3}
            placeholder="What you’d like to happen, in your own words"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            maxLength={1000}
          />

          {propose.isError && (
            <p role="alert" className="mt-[4px] text-[12px] text-risk-on-soft">
              {problemMessage(propose.error, 'We couldn’t send that offer. Try again.')}
            </p>
          )}
        </>
      ) : (
        <NoteBanner>
          Mediation has closed on this case. The evidence above is what a reviewer is looking at.
        </NoteBanner>
      )}

      <ActionStack>
        {open && (
          <Button disabled={!ready || propose.isPending} onClick={submit}>
            {propose.isPending ? 'Sending…' : 'Submit for mediation'}
          </Button>
        )}
        <Button asChild variant="secondary">
          <a href={disputeStatusHref(id)}>Back to the case</a>
        </Button>
        <Button asChild variant="ghost">
          <a href={tradeHref(id)}>Return to trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}

/** One side of the comparison. Always drawn; an empty one says so. */
function Panel({ title, panel }: { title: string; panel: ComparisonPanel }): React.JSX.Element {
  const count = panel.fromTrade.length + panel.fromDispute.length;
  return (
    <section className="rounded-md border border-solid border-border-hairline p-[10px]">
      <h3 className="mb-[8px] text-[11px] font-bold uppercase tracking-[.04em] text-slate">{title}</h3>
      {count === 0 ? (
        <EmptyState tone="empty" title="Nothing added yet" body="No photos on this side of the case." />
      ) : (
        <p className="text-[12px] text-slate">
          {count} {count === 1 ? 'item' : 'items'} on the record
        </p>
      )}
    </section>
  );
}
