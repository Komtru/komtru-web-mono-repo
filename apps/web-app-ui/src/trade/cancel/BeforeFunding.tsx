'use client';

import type { TradeView } from '@komtru/api-client';
import { useCancelTrade, usePaymentStatus } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  LoadingScreen,
  NoteBanner,
  RiskBanner,
  TextField,
  WarnBanner,
} from '@komtru/ui-kit';
import { useState } from 'react';
import { Frame, tradeHref } from '../delivery/parts';
import { platformWords, problemMessage } from '../format';
import { ItemSummary } from '../parts';
import { paymentGuard, type PaymentRead } from './words';

/**
 * CT1: withdraw from an agreed trade before it is funded. The reference says "no money has moved", but a buyer's
 * bank transfer can land after they left checkout and the platform does not stop the cancel for it, so the buyer's
 * payment status is read first and decides what the screen offers (see `paymentGuard`). The seller cannot read the
 * buyer's payment, so the seller is told only what the trade's status proves: no payment has been confirmed.
 */
export function BeforeFunding({
  trade,
  onCancelled,
}: {
  trade: TradeView;
  onCancelled: () => void;
}): React.JSX.Element {
  const buyerOnUnpaid = trade.yourRole === 'BUYER' && trade.status === 'PENDING_PAYMENT';
  const payment = usePaymentStatus(trade.id, buyerOnUnpaid);
  const cancel = useCancelTrade();
  const [reason, setReason] = useState('');
  const [noMoneySent, setNoMoneySent] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  // A read in flight is not an answer: a cached "no payment" must not stand in for the live status, so the cancel is
  // withdrawn while the platform is being asked again (a transfer may have moved to verifying or confirmed since).
  const read: PaymentRead = !buyerOnUnpaid
    ? { state: 'not-needed' }
    : payment.isFetching
      ? { state: 'loading' }
      : payment.isError
        ? { state: 'failed' }
        : payment.data === undefined
          ? { state: 'loading' }
          : { state: 'read', displayState: payment.data.displayState };
  const guard = paymentGuard(read);

  const submit = () => {
    if (guard !== 'free' && !(guard === 'confirm' && noMoneySent)) return;
    setProblem(undefined);
    const trimmed = reason.trim();
    cancel.mutate(
      { id: trade.id, ...(trimmed === '' ? {} : { reason: trimmed }) },
      {
        onSuccess: onCancelled,
        onError: (error) => {
          setProblem(
            platformWords(error, problemMessage(error, 'We couldn’t cancel the trade. Nothing was changed.')),
          );
        },
      },
    );
  };

  if (guard === 'checking') {
    return (
      <Frame title="Cancel this trade?" id={trade.id}>
        <LoadingScreen label="Checking the payment" />
      </Frame>
    );
  }

  return (
    <Frame title="Cancel this trade?" id={trade.id}>
      <ItemSummary trade={trade} />
      {guard === 'blocked' && (
        <>
          <WarnBanner title="Wait for the payment">
            A payment on this trade may already have reached Komtru, or may still be on its way. Cancelling
            now could leave money without a trade, so this can’t be cancelled from here until the payment
            settles.
          </WarnBanner>
          <ActionStack>
            <Button asChild variant="secondary">
              <a href={tradeHref(trade.id)}>Open the trade</a>
            </Button>
          </ActionStack>
        </>
      )}
      {guard === 'unknown' && (
        <>
          <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
            We couldn’t check whether a payment is on its way, so the trade can’t be cancelled right now.
          </p>
          <ActionStack>
            <Button type="button" variant="secondary" onClick={() => void payment.refetch()}>
              Try again
            </Button>
            <Button asChild variant="ghost">
              <a href={tradeHref(trade.id)}>Open the trade</a>
            </Button>
          </ActionStack>
        </>
      )}
      {(guard === 'free' || guard === 'confirm') && (
        <>
          {guard === 'confirm' ? (
            <WarnBanner title="A payment may be on its way">
              You started a payment that hasn’t been confirmed. If you have already sent a transfer, don’t
              cancel: let it be confirmed first.
            </WarnBanner>
          ) : trade.yourRole === 'BUYER' ? (
            <NoteBanner>
              No payment has been started on this trade, so there’s nothing to refund. Cancelling ends the
              trade for both of you.
            </NoteBanner>
          ) : (
            <NoteBanner>
              Komtru hasn’t confirmed a payment on this trade. Cancelling ends the trade for both of you.
            </NoteBanner>
          )}
          <TextField
            label="Why are you cancelling? (optional)"
            value={reason}
            maxLength={500}
            placeholder="Found it elsewhere, changed my mind, etc."
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          {guard === 'confirm' && (
            <label className="mb-[14px] flex items-start gap-[10px] text-[12.5px] leading-[1.5]">
              <input
                type="checkbox"
                className="mt-[3px] h-[16px] w-[16px] shrink-0 accent-trust-indigo"
                checked={noMoneySent}
                onChange={(event) => {
                  setNoMoneySent(event.target.checked);
                }}
              />
              <span>I haven’t sent any money for this trade</span>
            </label>
          )}
          {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
          <ActionStack>
            <Button
              type="button"
              variant="danger"
              disabled={cancel.isPending || (guard === 'confirm' && !noMoneySent)}
              onClick={submit}
            >
              {cancel.isPending ? 'Cancelling…' : 'Yes, cancel this trade'}
            </Button>
            <Button asChild variant="secondary">
              <a href={tradeHref(trade.id)}>Keep the trade</a>
            </Button>
          </ActionStack>
        </>
      )}
    </Frame>
  );
}
