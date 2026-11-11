'use client';

// DE1 (entry), DE2 and DE3 on the overview of a paid trade: what the delivery deadline means right now. The
// deadline is read once (the `Deadline` strip above shares the query), so this adds no request.
import { useDeliveryDeadline, useRespondToDeliveryExtension } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  NoteBanner,
  RiskBanner,
  SectionLabel,
  TermList,
  TermRow,
  WarnBanner,
} from '@komtru/ui-kit';
import { useState } from 'react';
import { deliveryTimeState, overdueWords, reasonLabel } from '../delivery-time';
import { partyName, platformWords, whenLabel } from '../format';
import { extendHref } from '../workspace-state';
import type { BodyProps } from './shared';

export function DeliveryTime({ trade, role }: BodyProps): React.JSX.Element | null {
  const read = useDeliveryDeadline(trade.id, true);
  if (read.data === undefined) return null;
  return <Panel trade={trade} role={role} read={read.data} />;
}

type Read = NonNullable<ReturnType<typeof useDeliveryDeadline>['data']>;

function Panel({ trade, role, read }: BodyProps & { read: Read }): React.JSX.Element | null {
  const respond = useRespondToDeliveryExtension();
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const state = deliveryTimeState(read, role, new Date());
  const request = read.extensionRequest;
  const counterparty =
    trade.counterparty === undefined || trade.counterparty === null
      ? undefined
      : partyName(trade.counterparty);

  const answer = (decision: 'ACCEPT' | 'DECLINE') => {
    if (request === null) return;
    setProblem(undefined);
    respond.mutate(
      { id: trade.id, requestId: request.id, decision },
      {
        onError: (error) => {
          setProblem(platformWords(error, 'We couldn’t send your answer. Try again.'));
        },
      },
    );
  };

  switch (state.kind) {
    case 'none':
      return null;
    case 'overdue': {
      const words = overdueWords(role, trade.status === 'SHIPPED', whenLabel(state.dueAt), counterparty);
      return <WarnBanner title={words.title}>{words.body}</WarnBanner>;
    }
    case 'request-declined':
      return (
        <NoteBanner title="The buyer declined">
          The delivery date stays as it was. You can’t ask again for this deadline.
        </NoteBanner>
      );
    case 'can-ask':
      return (
        <ActionStack>
          <Button asChild variant="secondary">
            <a href={extendHref(trade.id)}>Ask the buyer for more time</a>
          </Button>
        </ActionStack>
      );
    case 'request-pending':
      if (role === 'SELLER') {
        return (
          <NoteBanner title="Waiting for the buyer">
            You asked for more time to deliver. The date stays as it is until they answer.
          </NoteBanner>
        );
      }
      return (
        <>
          <SectionLabel>{`${counterparty ?? 'The seller'} needs more time`}</SectionLabel>
          <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
            Your money stays exactly as protected as it is now. Accepting only moves the delivery date.
          </p>
          <TermList aria-label="Request for more time">
            <TermRow label="Reason given">{reasonLabel(request?.reason)}</TermRow>
            {request?.currentDueAt !== undefined && (
              <TermRow label="Original date">{whenLabel(request.currentDueAt)}</TermRow>
            )}
            {request?.requestedDueAt !== undefined && (
              <TermRow label="Requested date">{whenLabel(request.requestedDueAt)}</TermRow>
            )}
            {typeof request?.note === 'string' && request.note !== '' && (
              <TermRow label="Note">{request.note}</TermRow>
            )}
          </TermList>
          <p className="mb-[14px] text-[11.5px] leading-[1.6] text-trust-gray">
            If you’d rather not wait, decline. The original date stands, and a missed date is handled as it is
            today.
          </p>
          {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
          <ActionStack>
            <Button
              type="button"
              disabled={respond.isPending}
              onClick={() => {
                answer('ACCEPT');
              }}
            >
              {respond.isPending ? 'Sending…' : 'Accept new date'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={respond.isPending}
              onClick={() => {
                answer('DECLINE');
              }}
            >
              Decline
            </Button>
          </ActionStack>
        </>
      );
  }
}
