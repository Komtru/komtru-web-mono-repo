'use client';

import type { TradeView } from '@komtru/api-client';
import { ActionStack, StatusHero } from '@komtru/ui-kit';
import { BACK_TO_TRADES } from '../parts';
import { partyName } from '../format';

/**
 * CT2: an agreed trade that ended before it was funded. A `CANCELLED` trade is one the platform never confirmed a
 * payment on (a funded trade is refunded, not cancelled), and that is all this says; it does not say the buyer sent
 * nothing, because a transfer can land after the cancel and only the buyer knows what they sent.
 */
export function TradeCancelled({
  trade,
  justNow = false,
}: {
  trade: TradeView;
  /** The reader cancelled it a moment ago, so the other side has just been told. */
  justNow?: boolean;
}): React.JSX.Element {
  const other =
    trade.counterparty === undefined || trade.counterparty === null
      ? 'The other side'
      : partyName(trade.counterparty);
  return (
    <>
      <StatusHero tone="warning" as="h2" title="Trade cancelled">
        {justNow ? `${other} has been notified. ` : ''}
        Komtru never confirmed a payment on this trade, so there is nothing to settle.
      </StatusHero>
      {trade.yourRole === 'BUYER' && (
        <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
          If you did send a payment for this trade, keep the receipt and contact Komtru support with the trade
          code {trade.tradeCode}.
        </p>
      )}
      <ActionStack>{BACK_TO_TRADES}</ActionStack>
    </>
  );
}
