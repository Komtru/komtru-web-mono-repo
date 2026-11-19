'use client';

// SP-M23 — "Withdraw a dispute". A dispute can be closed by the person who opened it, with the
// consequences stated before they do it.
//
// The three "what happens" steps are the point of the screen, and each one is a real consequence
// the platform will carry out: the case closes, the other side is told, and the inspection window
// the trade was already running keeps running. The screen states the first two plainly; it states
// the third only in general terms, because the inspection deadline belongs to the trade and this
// screen has not read it.
import { useState } from 'react';
import type { DisputeDetail } from '@komtru/api-client';
import { useWithdrawDispute } from '@komtru/api-client/react';
import { ActionStack, Button, NoteBanner, SectionLabel, VersionTimeline } from '@komtru/ui-kit';
import { Frame, Refusal, TradeGate } from '../delivery/parts';
import { problemMessage } from '../format';
import { DisputeGate, ReasonChoice } from './parts';
import { disputeStatusHref, tradeHref } from './routes';
import { WITHDRAW_REASONS, canWithdraw } from './words';

const TITLE = 'Withdraw';

export function Withdraw({ id, disputeId }: { id: string; disputeId?: string }): React.JSX.Element {
  return (
    <TradeGate id={id} title={TITLE}>
      {() => (
        <DisputeGate id={id} disputeId={disputeId} title={TITLE}>
          {(dispute) => {
            const mine = dispute.yourRole === 'BUYER' ? dispute.buyerUserId : dispute.sellerUserId;
            return canWithdraw(dispute, mine) ? (
              <Form id={id} dispute={dispute} />
            ) : (
              <Refusal
                id={id}
                title={TITLE}
                why={
                  dispute.openedByUserId === mine
                    ? 'This case is past the point where it can be withdrawn. It is with a reviewer now, and their decision will close it.'
                    : 'Only the person who opened this dispute can withdraw it. You can agree an outcome with them instead.'
                }
              />
            );
          }}
        </DisputeGate>
      )}
    </TradeGate>
  );
}

function Form({ id, dispute }: { id: string; dispute: DisputeDetail }): React.JSX.Element {
  const [reason, setReason] = useState<string | null>(null);
  const withdraw = useWithdrawDispute();

  return (
    <Frame title={TITLE} id={id}>
      <h2 className="mb-[6px] font-display text-[19px] font-semibold text-midnight-text">
        Withdraw this dispute?
      </h2>
      <p className="mb-[16px] text-[12.5px] leading-[1.5] text-slate">
        Only do this if it has really been sorted out.
      </p>

      <ReasonChoice
        legend="Why are you closing it?"
        name="withdraw-reason"
        options={WITHDRAW_REASONS.map((option) => ({ id: option.code, label: option.label }))}
        value={reason}
        onChange={setReason}
      />

      <SectionLabel>What happens</SectionLabel>
      <VersionTimeline
        aria-label="What happens when you withdraw"
        steps={[
          { id: 'closes', title: 'The dispute closes', detail: 'The other side is told', state: 'active' },
          {
            id: 'inspection',
            title: 'Your inspection window keeps running',
            detail: 'Where the trade still has one',
            state: 'pending',
          },
          {
            id: 'release',
            title: 'Payment is released when you confirm or the window ends',
            detail: 'It can’t be reopened after that',
            state: 'pending',
          },
        ]}
      />

      <NoteBanner>
        Settled with the other party? You can also agree an outcome on the case and keep your protection.
      </NoteBanner>

      {withdraw.isError && (
        <p role="alert" className="mt-[12px] text-[12px] text-risk-on-soft">
          {problemMessage(withdraw.error, 'We couldn’t withdraw the dispute. Try again.')}
        </p>
      )}

      <ActionStack>
        <Button
          disabled={reason === null || withdraw.isPending}
          onClick={() => {
            if (reason === null || withdraw.isPending) return;
            const label = WITHDRAW_REASONS.find((option) => option.code === reason)?.label ?? reason;
            withdraw.mutate(
              { disputeId: dispute.id, tradeId: id, reason: label },
              {
                onSuccess: () => {
                  window.location.assign(tradeHref(id));
                },
              },
            );
          }}
        >
          {withdraw.isPending ? 'Withdrawing…' : 'Withdraw the dispute'}
        </Button>
        <Button asChild variant="secondary">
          <a href={disputeStatusHref(id)}>Keep it open</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
