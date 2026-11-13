import type { Metadata } from 'next';
import { Evidence } from '../../../../../src/trade/delivery/Evidence';
import { DeliveryPage } from '../../../../../src/trade/delivery/page';

export const metadata: Metadata = { title: 'Trade Evidence' };

/** F-028 (CWT-S12). */
export default function Page({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  return DeliveryPage({ params, render: (id) => <Evidence id={id} /> });
}
