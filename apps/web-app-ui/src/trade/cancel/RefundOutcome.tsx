'use client';

import type { Cancellation, Refund, TradeView } from '@komtru/api-client';
import { useCancellation, useTradeRefunds } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  SectionLabel,
  Skeleton,
  StatusHero,
  TermList,
  TermRow,
  type StatusHeroTone,
} from '@komtru/ui-kit';
import { naira, partyName } from '../format';
import { BACK_TO_TRADES, ItemSummary } from '../parts';
import { FurtherViews } from '../workspace/shared';
import { SubReadFailed } from '../delivery/parts';
import { feeTreatmentWords, reasonLabelOf, refundStage, type RefundStage } from './words';
import type { TradeRole } from '../workspace-state';

/**
 * A trade that was cancelled after payment (CR3 for the buyer whose request was agreed, SC2 for the seller who could
 * not fulfil, and the plain refund for an overdue delivery). It says only what THIS trade's refund row says: the
 * amounts are the ledger's as sent (the fee rule is applied there, never here), "issued" is said only of a
 * `PROCESSED` refund, a refund still moving or held is said to be, and with no refund row it says nothing about money.
 */
export function RefundOutcome({ trade, role }: { trade: TradeView; role: TradeRole }): React.JSX.Element {
  const refunds = useTradeRefunds(trade.id);
  const cancellation = useCancellation(trade.id);
  const { stage, refund } = refundStage(refunds.data?.refunds ?? []);
  const other =
    trade.counterparty === undefined || trade.counterparty === null
      ? role === 'BUYER'
        ? 'The seller'
        : 'The buyer'
      : partyName(trade.counterparty);
  const hero = heroFor({
    role,
    stage,
    refund,
    cancellation: cancellation.data,
    other,
    loading: refunds.isPending,
    failed: refunds.isError,
  });

  return (
    <>
      <StatusHero tone={hero.tone} as="h2" title={hero.title}>
        {hero.body}
      </StatusHero>
      {refunds.isPending && <Skeleton className="mb-[14px]" />}
      {refunds.isError && <SubReadFailed noun="the refund details" onRetry={() => void refunds.refetch()} />}
      {role === 'BUYER' && refund !== undefined && <RefundLines refund={refund} stage={stage} />}
      {role === 'SELLER' && refund !== undefined && (
        <p className="mb-[14px] text-[11.5px] text-trust-gray">{`Refund reference ${refund.reference}`}</p>
      )}
      <ItemSummary trade={trade} />
      {role === 'BUYER' && cancellation.data?.request?.requestedByRole === 'SELLER' ? (
        <ActionStack>
          <Button asChild>
            <a href="/trade/new">Start a new trade</a>
          </Button>
          <Button asChild variant="secondary">
            <a href={`/trade/${trade.id}/terms`}>View agreed terms</a>
          </Button>
          {BACK_TO_TRADES}
        </ActionStack>
      ) : (
        <FurtherViews trade={trade} />
      )}
    </>
  );
}

/** The money lines, exactly as the platform sent them. Nothing is added up or taken away here. */
function RefundLines({ refund, stage }: { refund: Refund; stage: RefundStage }): React.JSX.Element {
  return (
    <>
      <SectionLabel>The refund</SectionLabel>
      <TermList aria-label="The refund">
        <TermRow label={stage === 'issued' ? 'Refunded to you' : 'Refund'}>
          {naira(refund.amountMinor)}
        </TermRow>
        <TermRow label="Item">{naira(refund.itemAmountMinor)}</TermRow>
        {refund.feeAmountMinor !== '0' ? (
          <TermRow label="Buyer protection fee">
            {`${naira(refund.feeAmountMinor)} · ${feeTreatmentWords(refund.buyerProtectionFeeTreatment)}`}
          </TermRow>
        ) : (
          // The platform returns a zero fee when it kept the fee, so the amount is not there to show: say so.
          refund.buyerProtectionFeeTreatment !== 'REFUND' && (
            <TermRow label="Buyer protection fee">
              {feeTreatmentWords(refund.buyerProtectionFeeTreatment)}
            </TermRow>
          )
        )}
        <TermRow label="Reference">{refund.reference}</TermRow>
      </TermList>
    </>
  );
}

interface Hero {
  tone: StatusHeroTone;
  title: string;
  body: string;
}

/** What put the trade here, in the words of the request or the platform's own reason. */
function causeWords(
  role: TradeRole,
  other: string,
  cancellation: Cancellation | undefined,
  refund: Refund | undefined,
): string {
  const request = cancellation?.request ?? null;
  if (request?.requestedByRole === 'BUYER' && request.status === 'APPROVED') {
    return role === 'BUYER'
      ? `${other} approved your cancellation request.`
      : 'You agreed to the buyer’s cancellation request.';
  }
  if (request?.requestedByRole === 'SELLER')
    return `Reason given: ${reasonLabelOf(request.reason).toLowerCase()}.`;
  if (refund?.reason === 'DELIVERY_OVERDUE') {
    return 'The delivery date passed without the item shipping.';
  }
  return '';
}

function heroFor(input: {
  role: TradeRole;
  stage: RefundStage;
  refund: Refund | undefined;
  cancellation: Cancellation | undefined;
  other: string;
  loading: boolean;
  failed: boolean;
}): Hero {
  const { role, stage, refund, cancellation, other, loading, failed } = input;
  const cause = causeWords(role, other, cancellation, refund);
  const sellerCancelled = cancellation?.request?.requestedByRole === 'SELLER';
  const join = (...parts: string[]) => parts.filter((part) => part !== '').join(' ');

  // Nothing about money until a refund row says it.
  if (refund === undefined) {
    return {
      tone: 'warning',
      title: sellerCancelled && role === 'SELLER' ? 'You cancelled this trade' : 'Cancelled after payment',
      body: join(
        cause,
        loading
          ? 'Loading the refund details.'
          : failed
            ? 'The trade was cancelled after payment.'
            : 'We can’t see the refund details yet. They show here as soon as the platform has them.',
      ),
    };
  }

  const amount = naira(refund.amountMinor);
  if (role === 'SELLER') {
    const words: Record<RefundStage, string> = {
      none: '',
      issued: 'The buyer’s refund has been sent.',
      'on-its-way': 'The buyer’s refund is being processed.',
      held: 'The buyer’s refund hasn’t completed yet.',
    };
    return {
      tone: stage === 'issued' ? 'success' : 'warning',
      title: sellerCancelled
        ? 'You cancelled this trade'
        : stage === 'issued'
          ? 'Cancelled and refunded'
          : 'Cancelled after payment',
      body: join(cause, words[stage]),
    };
  }

  const title = (fallback: string): string => (sellerCancelled ? `${other} couldn’t fulfil this` : fallback);
  switch (stage) {
    case 'issued':
      return {
        tone: sellerCancelled ? 'warning' : 'success',
        title: title(refund.scope === 'FULL' ? 'Refund issued in full' : 'Refund issued'),
        body: join(cause, `${amount} was sent back to your original payment method.`),
      };
    case 'held':
      return {
        tone: 'risk',
        title: title('Your refund hasn’t completed'),
        body: join(
          cause,
          refund.failureReason ?? '',
          `Contact support with the reference ${refund.reference}.`,
        ),
      };
    default:
      return {
        tone: 'info',
        title: title('Refund on its way'),
        body: join(cause, `${amount} is being sent back to your original payment method.`),
      };
  }
}
