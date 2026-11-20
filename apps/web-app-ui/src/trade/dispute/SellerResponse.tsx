'use client';

// Seller-8 — "Your Response". Evidence over opinion, Constitutional Principle II.
//
// A note on copy the reference carries but this screen does not. The reference opens with an
// advisory block: "Buyers who receive a clear, evidence-backed response within a few hours are
// far more likely to accept a reshipment over escalating." That is a statistical claim about
// buyer behaviour, and nothing in the platform measures it. T-197's review history shows this
// exact class of copy — a screen asserting a rule or a result the app does not back — being
// rewritten, so it is not shipped as written. The sentence here says the true version: a clear
// response is what the reviewer will read. Recorded as a deviation on the ui-review file and
// parked for the owner.
import { useState } from 'react';
import type { DisputeDetail } from '@komtru/api-client';
import { useProposeSettlement, useSubmitDisputeEvidence } from '@komtru/api-client/react';
import { ActionStack, Button, NoteBanner, TextArea } from '@komtru/ui-kit';
import { Frame, Refusal, TradeGate } from '../delivery/parts';
import { problemMessage } from '../format';
import { DisputeCountdown, DisputeGate, ReasonChoice } from './parts';
import { comparisonHref, disputeStatusHref } from './routes';

const TITLE = 'Your Response';

/**
 * What the seller may offer. The reference also lists "Reship the correct color, no extra cost", but that has no
 * money outcome the platform can enforce: the only fit is RELEASE_SELLER_FULL, which would pay the seller the whole
 * escrow on the promise of a replacement nothing checks. A replacement is F-034's track (design Q10 records it as an
 * agreed note beside a money outcome), so it is not offered here.
 */
const PROPOSALS = [
  {
    id: 'REFUND',
    label: 'Full refund',
    outcome: 'REFUND_BUYER_FULL' as const,
    note: null,
  },
];

export function SellerResponse({ id, disputeId }: { id: string; disputeId?: string }): React.JSX.Element {
  return (
    <TradeGate
      id={id}
      title={TITLE}
      role="SELLER"
      deniedWhy="This is the seller's response screen. Open the case from your own side of the trade."
    >
      {() => (
        <DisputeGate id={id} disputeId={disputeId} title={TITLE}>
          {(dispute) =>
            dispute.status === 'MEDIATION' || dispute.status === 'OPEN_EVIDENCE_COLLECTION' ? (
              <Form id={id} dispute={dispute} />
            ) : (
              <Refusal
                id={id}
                title={TITLE}
                why="This case is with a reviewer now. What you have already sent is what they are reading."
              />
            )
          }
        </DisputeGate>
      )}
    </TradeGate>
  );
}

function Form({ id, dispute }: { id: string; dispute: DisputeDetail }): React.JSX.Element {
  const [account, setAccount] = useState('');
  const [proposal, setProposal] = useState<string | null>(null);
  const submitEvidence = useSubmitDisputeEvidence();
  const propose = useProposeSettlement();

  const busy = submitEvidence.isPending || propose.isPending;
  const ready = account.trim().length > 0;
  const error = submitEvidence.error ?? propose.error;
  const canOffer = dispute.status === 'MEDIATION';

  const send = (): void => {
    if (!ready || busy) return;
    submitEvidence.mutate(
      { disputeId: dispute.id, note: account.trim() },
      {
        onSuccess: () => {
          const choice = PROPOSALS.find((option) => option.id === proposal);
          // The written answer is the response; an offer is optional, and only while the parties
          // still own the case. Sent second so a failed offer never loses the account of events.
          if (choice === undefined || !canOffer) {
            window.location.assign(disputeStatusHref(id));
            return;
          }
          const whole = dispute.totalEscrowMinor;
          propose.mutate(
            {
              disputeId: dispute.id,
              outcome: choice.outcome,
              amountToBuyerMinor: choice.outcome === 'REFUND_BUYER_FULL' ? whole : '0',
              amountToSellerMinor: choice.outcome === 'REFUND_BUYER_FULL' ? '0' : whole,
              ...(choice.note === null ? {} : { note: choice.note }),
            },
            {
              onSuccess: () => {
                window.location.assign(disputeStatusHref(id));
              },
            },
          );
        },
      },
    );
  };

  return (
    <Frame title={TITLE} id={id}>
      <DisputeCountdown dispute={dispute} />

      <NoteBanner title="Before you respond">
        A clear, evidence-backed answer is what the reviewer reads first. Say what happened and attach what
        shows it.
      </NoteBanner>

      <TextArea
        label="What actually happened?"
        rows={5}
        placeholder="Explain your side"
        value={account}
        onChange={(event) => {
          setAccount(event.target.value);
        }}
        maxLength={4000}
      />

      {canOffer && (
        <ReasonChoice
          legend="Proposed resolution (optional)"
          name="seller-proposal"
          options={PROPOSALS.map((option) => ({ id: option.id, label: option.label }))}
          value={proposal}
          onChange={setProposal}
        />
      )}

      {error !== null && (
        <p role="alert" className="mt-[4px] text-[12px] text-risk-on-soft">
          {problemMessage(error, 'We couldn’t send your response. Try again.')}
        </p>
      )}

      <ActionStack>
        <Button disabled={!ready || busy} onClick={send}>
          {busy ? 'Sending…' : 'Submit response'}
        </Button>
        <Button asChild variant="secondary">
          <a href={comparisonHref(id)}>Add photos and compare</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
