'use client';

import type { TradeView } from '@komtru/api-client';
import { useDeclineTrade } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  NoteBanner,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  TermList,
  TermRow,
  TextField,
} from '@komtru/ui-kit';
import { useState } from 'react';
import { partyName, problemMessage } from '../format';
import { ConfirmSheet, ItemSummary } from '../parts';
import { readRequest } from './read';

const WAITING = <span className="font-semibold text-warning-on-soft">Waiting</span>;

/**
 * CT-B6. The seller sees what the buyer asked for and, separately, the three things only they can provide. The
 * decision to answer comes first; the work is the next screens.
 */
export function SellerRequest({ trade }: { trade: TradeView }): React.JSX.Element {
  const decline = useDeclineTrade();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const request = readRequest(trade);
  const buyer =
    trade.counterparty === undefined || trade.counterparty === null
      ? undefined
      : partyName(trade.counterparty);

  const onDecline = () => {
    setProblem(undefined);
    decline.mutate(
      { id: trade.id, reason: reason.trim() },
      {
        onSuccess: () => {
          setDeclining(false);
        },
        onError: (error) => {
          setDeclining(false);
          setProblem(problemMessage(error, "We couldn't decline that. Try again."));
        },
      },
    );
  };

  return (
    <ScreenColumn>
      <ScreenHeader title="Trade Request" backHref="/trades" />
      <ItemSummary trade={trade} />
      {buyer !== undefined && <p className="-mt-[8px] mb-[16px] text-[12px] text-slate">Buyer: {buyer}</p>}
      <SectionLabel>What the buyer asked for</SectionLabel>
      <TermList aria-label="What the buyer asked for">
        <TermRow label="Delivery">{request.deliveryLine}</TermRow>
        {request.collectionPhone !== undefined && (
          <TermRow label="Collection phone">{request.collectionPhone}</TermRow>
        )}
        {trade.categoryName !== null && <TermRow label="Category">{trade.categoryName}</TermRow>}
      </TermList>
      <SectionLabel>What only you can provide</SectionLabel>
      <TermList aria-label="What only you can provide">
        <TermRow label="Item details">{WAITING}</TermRow>
        <TermRow label="Delivery charge">{WAITING}</TermRow>
        <TermRow label="Delivery promise">{WAITING}</TermRow>
      </TermList>
      <NoteBanner>
        The buyer can&apos;t edit item details. What you confirm becomes the accepted specification.
      </NoteBanner>
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        <Button asChild>
          <a href={`/trade/${trade.id}/complete`}>Complete the details</a>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="self-center"
          onClick={() => {
            setDeclining(true);
          }}
        >
          Decline
        </Button>
      </ActionStack>
      <ConfirmSheet
        open={declining}
        title="Decline this request"
        confirm="Decline request"
        pending={decline.isPending}
        onConfirm={onDecline}
        onClose={() => {
          setDeclining(false);
        }}
      >
        <p className="mb-[12px] text-[12.5px] leading-[1.5] text-slate">
          They&apos;ll see your reason. This ends the request.
        </p>
        <TextField
          label="Reason"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          {...(reason.trim().length > 0 && reason.trim().length < 3
            ? { helper: 'Give a few words', invalid: true }
            : {})}
        />
      </ConfirmSheet>
    </ScreenColumn>
  );
}
