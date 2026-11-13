import type { Metadata } from 'next';
import { Handover } from '../../../../../../src/trade/delivery/Handover';
import { DeliveryPage } from '../../../../../../src/trade/delivery/page';

export const metadata: Metadata = { title: 'Hand Over' };

/** F-028 (CWT-S09). */
export default function Page({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  return DeliveryPage({ params, render: (id) => <Handover id={id} /> });
}
