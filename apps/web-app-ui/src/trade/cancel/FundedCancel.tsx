'use client';

import type { Cancellation, TradeView } from '@komtru/api-client';
import { createIdempotencyKey } from '@komtru/api-client';
import { useCancelAsSeller, useCancellation, useRequestCancellation } from '@komtru/api-client/react';
import { BUYER_CANCELLATION_REASONS, SELLER_CANCELLATION_REASONS } from '@komtru/shared-types';
import {
  ActionStack,
  Button,
  LoadingScreen,
  NoteBanner,
  RiskBanner,
  SectionLabel,
  TermList,
  TermRow,
  WarnBanner,
} from '@komtru/ui-kit';
import { useRef, useState } from 'react';
import { isDecidedRefusal } from '../../payouts/format';
import { Frame, ReadFailed, tradeHref } from '../delivery/parts';
import { partyName, platformWords } from '../format';
import { ConfirmSheet, ItemSummary } from '../parts';
import { Notice, ReasonChoice } from './parts';
import { reasonLabelOf } from './words';

const CANCEL_REQUEST_HREF = (id: string) => `/trade/${id}/cancel-request`;

const otherSide = (trade: TradeView): string =>
  trade.counterparty === undefined || trade.counterparty === null
    ? trade.yourRole === 'BUYER'
      ? 'The seller'
      : 'The buyer'
    : partyName(trade.counterparty);

/** The funded trade's cancellation read, then the buyer's side (CR1) or the seller's (SC1). */
export function FundedCancel({ trade }: { trade: TradeView }): React.JSX.Element {
  const read = useCancellation(trade.id);
  if (read.isPending) {
    return (
      <Frame title="Cancel this trade" id={trade.id}>
        <LoadingScreen label="Loading your options" />
      </Frame>
    );
  }
  if (read.isError) {
    return (
      <ReadFailed error={read.error} noun="the cancellation options" onRetry={() => void read.refetch()} />
    );
  }
  return trade.yourRole === 'BUYER' ? (
    <RequestCancellation trade={trade} read={read.data} />
  ) : (
    <CannotFulfil trade={trade} read={read.data} />
  );
}

/** What an answered or closed state says. A refund is only said to be requested when the platform says so. */
function closedWords(read: Cancellation): string {
  if (read.refundRequested) {
    return 'A refund has been requested for this trade. It shows on the trade once it has been processed.';
  }
  return 'This trade can’t be cancelled right now. If you think it should be, contact support.';
}

// ---------------------------------------------------------------------------
// CR1
// ---------------------------------------------------------------------------

function RequestCancellation({ trade, read }: { trade: TradeView; read: Cancellation }): React.JSX.Element {
  const ask = useRequestCancellation();
  const [reason, setReason] = useState<(typeof BUYER_CANCELLATION_REASONS)[number] | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  // One decision, one key: a "try again" after a lost answer is the same request, not a second one.
  const attempt = useRef<{ key: string; reason: string } | undefined>(undefined);
  const seller = otherSide(trade);
  const request = read.request;

  if (request !== null && request.requestedByRole === 'BUYER') {
    if (request.status === 'PENDING') {
      return (
        <Frame title="Request cancellation" id={trade.id}>
          <Notice id={trade.id} title="Request sent">
            {`${seller} has been asked to cancel (${reasonLabelOf(request.reason)}). Your payment stays protected until they answer.`}
          </Notice>
        </Frame>
      );
    }
    if (request.status === 'DECLINED') {
      return (
        <Frame title="Request cancellation" id={trade.id}>
          <Notice id={trade.id} title="Request declined" tone="warning">
            {`${seller} declined your request.${request.responseNote === null ? '' : ` They said: “${request.responseNote}”`}`}
            {read.tradeStatus === 'FUNDED' ? ' Your payment stays protected and the trade carries on.' : ''}
          </Notice>
        </Frame>
      );
    }
  }
  if (read.tradeStatus !== 'FUNDED') {
    return (
      <Frame title="Request cancellation" id={trade.id}>
        <Notice id={trade.id}>Cancelling is only possible before the item ships.</Notice>
      </Frame>
    );
  }
  if (!read.actions.canRequest) {
    return (
      <Frame title="Request cancellation" id={trade.id}>
        <Notice id={trade.id}>{closedWords(read)}</Notice>
      </Frame>
    );
  }

  const send = () => {
    if (reason === undefined) return;
    if (attempt.current?.reason !== reason) attempt.current = { key: createIdempotencyKey(), reason };
    setProblem(undefined);
    ask.mutate(
      { tradeId: trade.id, reason, idempotencyKey: attempt.current.key },
      {
        onError: (error) => {
          // Only a definitive refusal ends this request; a lost answer may have reached the platform, so the key stays.
          if (isDecidedRefusal(error)) attempt.current = undefined;
          setProblem(platformWords(error, 'We couldn’t send the request. Try again.'));
        },
      },
    );
  };

  return (
    <Frame title="Request cancellation" id={trade.id}>
      <ItemSummary trade={trade} />
      <NoteBanner>
        {`Your payment is protected in escrow. Cancelling here sends a request to ${seller} rather than refunding instantly, since they may already be preparing your order.`}
      </NoteBanner>
      <ReasonChoice
        legend="Why are you cancelling?"
        name="cancellation-reason"
        reasons={BUYER_CANCELLATION_REASONS}
        value={reason}
        onChange={setReason}
      />
      <SectionLabel>What happens next</SectionLabel>
      <TermList aria-label="What happens next">
        <TermRow label="Seller can">Agree or decline</TermRow>
        <TermRow label="If they agree">Your refund starts automatically</TermRow>
        <TermRow label="If they decline">Your payment stays protected</TermRow>
        <TermRow label="If they’ve already shipped">This request won’t be available</TermRow>
      </TermList>
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        <Button type="button" disabled={reason === undefined || ask.isPending} onClick={send}>
          {ask.isPending ? 'Sending…' : 'Send cancellation request'}
        </Button>
        <Button asChild variant="secondary">
          <a href={tradeHref(trade.id)}>Keep the trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// SC1
// ---------------------------------------------------------------------------

function CannotFulfil({ trade, read }: { trade: TradeView; read: Cancellation }): React.JSX.Element {
  const cancel = useCancelAsSeller();
  const [reason, setReason] = useState<(typeof SELLER_CANCELLATION_REASONS)[number] | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const attempt = useRef<{ key: string; reason: string } | undefined>(undefined);
  const buyer = otherSide(trade);
  const request = read.request;

  if (request !== null && request.requestedByRole === 'SELLER' && read.refundRequested) {
    return (
      <Frame title="Cancel this trade" id={trade.id}>
        <Notice id={trade.id} title="You cancelled this trade">
          {`Reason: ${reasonLabelOf(request.reason)}. ${buyer}’s refund has started. Nothing more is needed from you.`}
        </Notice>
      </Frame>
    );
  }
  if (read.tradeStatus !== 'FUNDED') {
    return (
      <Frame title="Cancel this trade" id={trade.id}>
        <Notice id={trade.id}>Cancelling is only possible before the item ships.</Notice>
      </Frame>
    );
  }
  if (!read.actions.canCancelAsSeller) {
    return (
      <Frame title="Cancel this trade" id={trade.id}>
        <Notice id={trade.id}>{closedWords(read)}</Notice>
      </Frame>
    );
  }

  const send = () => {
    if (reason === undefined) return;
    if (attempt.current?.reason !== reason) attempt.current = { key: createIdempotencyKey(), reason };
    setProblem(undefined);
    cancel.mutate(
      { tradeId: trade.id, reason, idempotencyKey: attempt.current.key },
      {
        onSuccess: () => {
          setConfirming(false);
        },
        onError: (error) => {
          setConfirming(false);
          if (isDecidedRefusal(error)) attempt.current = undefined;
          setProblem(platformWords(error, 'We couldn’t cancel the trade. Try again.'));
        },
      },
    );
  };

  return (
    <Frame title="Cancel this trade" id={trade.id}>
      {read.actions.canRespond && read.request !== null && (
        <NoteBanner title="The buyer asked to cancel">
          {`${buyer} asked to cancel this trade. You can answer their request instead.`}{' '}
          <a className="font-semibold underline" href={CANCEL_REQUEST_HREF(trade.id)}>
            Review the request
          </a>
        </NoteBanner>
      )}
      <WarnBanner title={`This refunds ${buyer}`}>
        Unlike a buyer’s cancellation request, there’s no review step: you’re the one unable to deliver, so
        their approval isn’t needed.
      </WarnBanner>
      <ReasonChoice
        legend="Why can’t you fulfil this?"
        name="cannot-fulfil-reason"
        reasons={SELLER_CANCELLATION_REASONS}
        value={reason}
        onChange={setReason}
      />
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        <Button
          type="button"
          variant="danger"
          disabled={reason === undefined || cancel.isPending}
          onClick={() => {
            setConfirming(true);
          }}
        >
          Cancel &amp; refund buyer
        </Button>
        <Button asChild variant="secondary">
          <a href={tradeHref(trade.id)}>Keep the trade</a>
        </Button>
      </ActionStack>
      <ConfirmSheet
        open={confirming}
        title="Cancel and refund the buyer?"
        confirm="Cancel and refund"
        pending={cancel.isPending}
        onConfirm={send}
        onClose={() => {
          setConfirming(false);
        }}
      >
        <p className="text-[12.5px] leading-[1.5] text-slate">
          This ends the trade and refunds {buyer}. It can’t be undone.
        </p>
      </ConfirmSheet>
    </Frame>
  );
}
