'use client';

import { useState } from 'react';
import { Frame, Refusal, TradeGate } from '../delivery/parts';
import { BeforeFunding } from './BeforeFunding';
import { FundedCancel } from './FundedCancel';
import { TradeCancelled } from './TradeCancelled';

/**
 * `/trade/[id]/cancel`: one address for every way out of a trade, because which one applies is the trade's to say.
 * An agreed trade nobody has paid for is CT1; a funded one is the buyer's request (CR1) or the seller's
 * can't-fulfil (SC1); anything else says why there is nothing to cancel, with no control.
 */
export function CancelTrade({ id }: { id: string }): React.JSX.Element {
  const [cancelledHere, setCancelledHere] = useState(false);
  return (
    <TradeGate id={id} title="Cancel this trade">
      {(trade) => {
        if (trade.status === 'PENDING_PAYMENT' || (cancelledHere && trade.status === 'CANCELLED')) {
          return trade.status === 'CANCELLED' ? (
            <Frame title="Cancel this trade" id={trade.id}>
              <TradeCancelled trade={trade} justNow />
            </Frame>
          ) : (
            <BeforeFunding
              trade={trade}
              onCancelled={() => {
                setCancelledHere(true);
              }}
            />
          );
        }
        if (trade.status === 'CANCELLED') {
          return (
            <Frame title="Cancel this trade" id={trade.id}>
              <TradeCancelled trade={trade} />
            </Frame>
          );
        }
        if (trade.status === 'FUNDED') return <FundedCancel trade={trade} />;
        return <Refusal id={trade.id} title="Cancel this trade" why={whyNot(trade.status)} />;
      }}
    </TradeGate>
  );
}

/** Why there is nothing to cancel, from the trade's own status and nothing else. */
function whyNot(status: string): string {
  switch (status) {
    case 'CANCELLED_REFUNDED':
      return 'This trade was cancelled after payment. The refund is shown on the trade.';
    case 'SHIPPED':
    case 'UNCONFIRMED_DELIVERY':
    case 'INSPECTION':
      return 'Cancelling is only possible before the item ships.';
    default:
      return 'This trade can’t be cancelled from here.';
  }
}
