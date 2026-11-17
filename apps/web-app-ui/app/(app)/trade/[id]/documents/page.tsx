import type { Metadata } from 'next';
import { DeliveryPage } from '../../../../../src/trade/delivery/page';
import { TradeDocuments } from '../../../../../src/trade/documents/TradeDocuments';

export const metadata: Metadata = { title: 'Receipt & documents' };

/** SP-M11 (F-044): the agreement, the receipt and the delivery proof of a completed Trade. A static route, so it takes precedence over `[tab]`. */
export default function Page({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  return DeliveryPage({ params, render: (id) => <TradeDocuments id={id} /> });
}
