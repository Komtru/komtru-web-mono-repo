import type { Metadata } from 'next';
import { CancelTrade } from '../../../../../src/trade/cancel/CancelTrade';
import { DeliveryPage } from '../../../../../src/trade/delivery/page';

export const metadata: Metadata = { title: 'Cancel this trade' };

/**
 * F-030 (CT1, CT2, CR1, SC1). One address for every way out of a trade: which screen it is depends on the trade's
 * status and the reader's side. A static route, so it takes precedence over `/trade/[id]/[tab]`.
 */
export default function Page({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  return DeliveryPage({ params, render: (id) => <CancelTrade id={id} /> });
}
