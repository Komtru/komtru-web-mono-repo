'use client';

import type { TradeView } from '@komtru/api-client';
import { useTradeActivity } from '@komtru/api-client/react';
import { ReadyBanner } from '@komtru/ui-kit';
import { nairaShort, partyName } from '../format';

/**
 * AR1: the inspection window closed without an answer and the platform released the payment itself. Shown only when
 * the trade's own activity records `INSPECTION_ELAPSED`, so a payment the buyer released by hand never gets it. The
 * amount is the trade's own fee snapshot, as the Settlement and Complete screens already show it. Release is said
 * to have happened only once the trade is `SETTLED`; while it is `COMPLETED` the money is still moving.
 * "Report an issue anyway" is disputes (F-032) and is not drawn.
 */
export function AutoReleaseNotice({ trade }: { trade: TradeView }): React.JSX.Element | null {
  const feed = useTradeActivity(trade.id);
  const { fees, terms } = trade;
  if (feed.data === undefined || fees === null) return null;
  const automatic = feed.data.pages.some((page) =>
    page.items.some((item) => item.kind === 'INSPECTION_ELAPSED'),
  );
  if (!automatic) return null;

  const buyer = trade.yourRole === 'BUYER';
  const done = trade.status === 'SETTLED';
  const verb = done ? 'was released' : 'is being released';
  const amount = nairaShort(buyer ? fees.itemAmountMinor : fees.sellerProceedsMinor);
  const seller =
    trade.counterparty === undefined || trade.counterparty === null
      ? 'the seller'
      : partyName(trade.counterparty);
  const window =
    terms === null ? 'inspection window' : `${String(terms.inspectionWindowHours)}-hour inspection window`;
  return (
    <ReadyBanner title="Payment released automatically">
      {buyer
        ? `Your ${window} closed without a response, so ${amount} ${verb} to ${seller} per the agreement’s own terms.`
        : `The buyer’s ${window} closed without a response, so ${amount} ${verb} to you per the agreement’s own terms.`}
    </ReadyBanner>
  );
}
