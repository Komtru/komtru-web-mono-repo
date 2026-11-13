import type { Metadata } from 'next';
import { DeliveryPage } from '../../../../../src/trade/delivery/page';
import { TradeRecord } from '../../../../../src/trade/proof/EvidenceTrail';

export const metadata: Metadata = { title: 'Trade Record' };

/** F-029 (PM-8): the media kept with a completed trade. A static route, so it takes precedence over `[tab]`. */
export default function Page({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  return DeliveryPage({ params, render: (id) => <TradeRecord id={id} /> });
}
