'use client';

import type { TradeView } from '@komtru/api-client';
import { usePaymentStatus } from '@komtru/api-client/react';
import { ActionStack, StatusHero } from '@komtru/ui-kit';
import { BACK_TO_TRADES } from '../parts';
import { partyName } from '../format';

/**
 * CT2: an agreed trade that ended before it was funded. A transfer can land after a cancel, and only the buyer's own
 * payment status can say whether one did, so "nothing to settle" is said to the buyer only when that status is read
 * and is `NONE` or `AWAITING_PAYMENT`. A payment that is verifying, confirmed, under review or not confirmed is told
 * to contact support with the trade code; while the status loads, or when it can't be read, only the trade's own
 * status is said. The seller cannot read the payment and is told only that the trade was cancelled before funding.
 */
export function TradeCancelled({
  trade,
  justNow = false,
}: {
  trade: TradeView;
  /** The reader cancelled it a moment ago, so the other side has just been told. */
  justNow?: boolean;
}): React.JSX.Element {
  const buyer = trade.yourRole === 'BUYER';
  const payment = usePaymentStatus(trade.id, buyer);
  const state = payment.isFetching ? undefined : payment.data?.displayState;
  const clear = state === 'NONE' || state === 'AWAITING_PAYMENT';
  const maybePaid = state !== undefined && !clear;
  const other =
    trade.counterparty === undefined || trade.counterparty === null
      ? 'The other side'
      : partyName(trade.counterparty);
  return (
    <>
      <StatusHero tone="warning" as="h2" title="Trade cancelled">
        {justNow ? `${other} has been notified. ` : ''}
        {buyer && clear
          ? 'Komtru never confirmed a payment on this trade, so there is nothing to settle.'
          : maybePaid
            ? 'A payment for this trade may have reached Komtru after it was cancelled.'
            : 'This trade was cancelled before it was funded.'}
      </StatusHero>
      {buyer && (
        <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
          {maybePaid
            ? `Contact Komtru support with the trade code ${trade.tradeCode}: the team has to settle it.`
            : `If you did send a payment for this trade, keep the receipt and contact Komtru support with the trade code ${trade.tradeCode}.`}
        </p>
      )}
      <ActionStack>{BACK_TO_TRADES}</ActionStack>
    </>
  );
}
