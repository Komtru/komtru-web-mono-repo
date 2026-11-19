'use client';

// H1 and H2 — "Dispute Resolved". The same case, two screens, asymmetric by design.
//
// This asymmetry is the reference's whole point and it is load-bearing, so it is worth saying
// plainly what it is. The buyer (H1) gets the outcome, the reasoning behind it and the timeline:
// they asked a question and this is the answer. The seller (H2) gets the outcome, what it means
// for their Trust Profile, and nothing else — no decision card, no timeline. Constitutional
// Principle VIII: the screen has to read as fact and next steps, not as a verdict on anyone's
// character, whichever way it went.
//
// Both are one component rather than two, so a change to one is a visible decision about the
// other rather than a drift nobody noticed.
import type { DisputeDecision, DisputeDetail, TradeView } from '@komtru/api-client';
import {
  ActionStack,
  Button,
  Chip,
  NoteBanner,
  ReadyBanner,
  SectionLabel,
  TradeRow,
  VersionTimeline,
} from '@komtru/ui-kit';
import { Frame } from '../delivery/parts';
import { naira } from '../format';
import { caseSteps } from './parts';
import { appealHref, tradeHref } from './routes';
import { TRUST_EVENT, TRUST_EVENT_LABEL, canAppeal, outcomeCopy } from './words';

export function Resolved({
  id,
  trade,
  dispute,
  decision,
  other,
}: {
  id: string;
  trade: TradeView;
  dispute: DisputeDetail;
  decision: DisputeDecision;
  other: string;
}): React.JSX.Element {
  const copy = outcomeCopy(dispute.yourRole, decision, other);
  const buyer = dispute.yourRole === 'BUYER';

  return (
    <Frame title={`Dispute · ${dispute.code}`} id={id}>
      <TradeRow
        amount={naira(dispute.totalEscrowMinor)}
        status={{ tone: 'resolved', label: 'Resolved' }}
        sub={trade.tradeCode}
      />

      {/* The one place the two screens differ in tone rather than content: the buyer's outcome is
          a resolution (emerald), the seller's is information (indigo). Painting the seller's red
          would make a corrective event read as a punishment. */}
      {copy.tone === 'success' ? (
        <ReadyBanner title={copy.title}>{copy.body}</ReadyBanner>
      ) : (
        <NoteBanner title={copy.title}>{copy.body}</NoteBanner>
      )}

      {copy.showRationale && (
        <>
          <SectionLabel>What TrustOps decided</SectionLabel>
          <blockquote className="mb-[14px] rounded-md border border-solid border-border-hairline bg-surface-primary p-[12px] text-[12.5px] leading-[1.6] text-slate">
            {decision.rationale}
          </blockquote>
          {decision.agreedNote !== null && (
            <p className="mb-[14px] text-[12px] leading-[1.5] text-slate">
              Agreed between you: {decision.agreedNote}
            </p>
          )}
        </>
      )}

      {buyer ? (
        <>
          <SectionLabel>Timeline</SectionLabel>
          <VersionTimeline aria-label="How this case was decided" steps={caseSteps(dispute, other)} />
        </>
      ) : (
        <>
          <SectionLabel>What this means for your Trust Profile</SectionLabel>
          {/* Two halves, as the reference draws them. The second is deliberately NOT a fulfilment
              percentage: the reference shows "98.7% — unaffected", but this screen has not read a
              Trust Profile and must not print a number it did not get. It says the true thing
              instead — the rating is untouched — and the figure is a deviation on the review. */}
          <dl className="mb-[14px] flex gap-[10px]">
            <div className="flex-1 rounded-md bg-trust-indigo-soft p-[12px]">
              <dd className="font-display text-[17px] font-semibold text-midnight-text">{TRUST_EVENT}</dd>
              <dt className="mt-[2px] text-[11px] text-slate">{TRUST_EVENT_LABEL}</dt>
            </div>
            <div className="flex-1 rounded-md bg-cloud-gray p-[12px]">
              <dd className="font-display text-[17px] font-semibold text-midnight-text">Unaffected</dd>
              <dt className="mt-[2px] text-[11px] text-slate">Your fulfilment rate</dt>
            </div>
          </dl>
        </>
      )}

      {copy.closing !== null && (
        <p className="mb-[4px] text-[12px] leading-[1.5] text-slate">{copy.closing}</p>
      )}

      {canAppeal(dispute) && (
        <p className="mt-[14px] text-[11.5px] leading-[1.5] text-trust-gray">
          If you disagree with this outcome, one appeal is available — reviewed by a specialist who wasn’t
          part of the original decision.
        </p>
      )}

      <ActionStack>
        {canAppeal(dispute) && (
          <Button asChild variant="secondary">
            <a href={appealHref(id)}>File an appeal</a>
          </Button>
        )}
        <Button asChild variant={canAppeal(dispute) ? 'primary' : 'secondary'}>
          <a href={buyer ? '/trades' : tradeHref(id)}>{buyer ? 'Back to Trades' : 'Back to the trade'}</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}

/** Kept beside the screen it belongs to: the chip the resolved states share. */
export const ResolvedChip = (): React.JSX.Element => <Chip tone="resolved">Resolved</Chip>;
