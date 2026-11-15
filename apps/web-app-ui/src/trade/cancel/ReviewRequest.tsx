'use client';

import type { Cancellation, TradeView } from '@komtru/api-client';
import { createIdempotencyKey } from '@komtru/api-client';
import { useApproveCancellation, useCancellation, useDeclineCancellation } from '@komtru/api-client/react';
import { ActionStack, Button, LoadingScreen, NoteBanner, RiskBanner, TextField } from '@komtru/ui-kit';
import { useRef, useState } from 'react';
import { isDecidedRefusal } from '../../payouts/format';
import { Frame, ReadFailed, TradeGate, tradeHref } from '../delivery/parts';
import { partyName, platformWords } from '../format';
import { ConfirmSheet, ItemSummary } from '../parts';
import { Notice } from './parts';
import { reasonLabelOf } from './words';

/**
 * CR2: the seller answers the buyer's cancellation request. The buttons come from the platform's `canRespond`.
 * There is no countdown and no automatic approval (the platform does not approve for a seller who stays silent),
 * and "contest" is a plain decline. Approving refunds the buyer and cannot be undone, so it asks once.
 */
export function ReviewRequest({ id }: { id: string }): React.JSX.Element {
  return (
    <TradeGate
      id={id}
      title="Cancellation request"
      role="SELLER"
      deniedWhy="Only the seller can answer a cancellation request."
    >
      {(trade) => <Review trade={trade} />}
    </TradeGate>
  );
}

function Review({ trade }: { trade: TradeView }): React.JSX.Element {
  const read = useCancellation(trade.id);
  if (read.isPending) {
    return (
      <Frame title="Cancellation request" id={trade.id}>
        <LoadingScreen label="Loading the request" />
      </Frame>
    );
  }
  if (read.isError) {
    return <ReadFailed error={read.error} noun="the request" onRetry={() => void read.refetch()} />;
  }
  return <Answer trade={trade} read={read.data} />;
}

function Answer({ trade, read }: { trade: TradeView; read: Cancellation }): React.JSX.Element {
  const approve = useApproveCancellation();
  const decline = useDeclineCancellation();
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  // One decision, one key: asked again after a lost answer it is the same answer, not a second one.
  const attempt = useRef<{ key: string; kind: 'approve' | 'decline' } | undefined>(undefined);
  const buyer =
    trade.counterparty === undefined || trade.counterparty === null
      ? 'The buyer'
      : partyName(trade.counterparty);
  const request = read.request;

  if (request === null) {
    return (
      <Frame title="Cancellation request" id={trade.id}>
        <Notice id={trade.id}>The buyer hasn’t asked to cancel this trade.</Notice>
      </Frame>
    );
  }
  if (request.requestedByRole === 'BUYER' && request.status === 'APPROVED') {
    return (
      <Frame title="Cancellation request" id={trade.id}>
        <Notice id={trade.id} title="You agreed to cancel">
          {read.refundRequested
            ? `${buyer}’s refund has started. Nothing more is needed from you.`
            : 'The cancellation is agreed.'}
        </Notice>
      </Frame>
    );
  }
  if (request.requestedByRole === 'BUYER' && request.status === 'DECLINED') {
    return (
      <Frame title="Cancellation request" id={trade.id}>
        <Notice id={trade.id} title="You declined the request" tone="warning">
          The trade carries on. Ship the item as agreed.
        </Notice>
      </Frame>
    );
  }
  if (!read.actions.canRespond) {
    return (
      <Frame title="Cancellation request" id={trade.id}>
        <Notice id={trade.id}>
          {request.status === 'LAPSED'
            ? 'This request is no longer waiting for an answer: the trade moved on without one.'
            : 'This request is no longer waiting for an answer.'}
        </Notice>
      </Frame>
    );
  }

  const answer = (kind: 'approve' | 'decline') => {
    if (attempt.current?.kind !== kind) attempt.current = { key: createIdempotencyKey(), kind };
    setProblem(undefined);
    const variables = {
      tradeId: trade.id,
      requestId: request.id,
      note,
      idempotencyKey: attempt.current.key,
    };
    const handlers = {
      onSuccess: () => {
        setConfirming(false);
      },
      onError: (error: unknown) => {
        setConfirming(false);
        if (isDecidedRefusal(error)) attempt.current = undefined;
        setProblem(platformWords(error, 'We couldn’t send your answer. Try again.'));
      },
    };
    if (kind === 'approve') approve.mutate(variables, handlers);
    else decline.mutate(variables, handlers);
  };
  const busy = approve.isPending || decline.isPending;

  return (
    <Frame title="Cancellation request" id={trade.id}>
      <ItemSummary trade={trade} />
      <p className="mb-[10px] text-[12.5px] leading-[1.6]">
        {`${buyer} wants to cancel: “${reasonLabelOf(request.reason)}”.`}
        {request.note === null ? '' : ` They wrote: “${request.note}”`}
      </p>
      <NoteBanner>
        Approving refunds the buyer, automatically. If you’ve already shipped, decline and the trade carries
        on.
      </NoteBanner>
      <TextField
        label="Note to the buyer (optional)"
        value={note}
        maxLength={500}
        onChange={(event) => {
          setNote(event.target.value);
        }}
      />
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            setConfirming(true);
          }}
        >
          Approve — refund buyer
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            answer('decline');
          }}
        >
          Decline — I’ve already shipped
        </Button>
        <Button asChild variant="ghost">
          <a href={tradeHref(trade.id)}>Back to the trade</a>
        </Button>
      </ActionStack>
      <ConfirmSheet
        open={confirming}
        title="Approve and refund the buyer?"
        confirm="Approve and refund"
        pending={approve.isPending}
        onConfirm={() => {
          answer('approve');
        }}
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
