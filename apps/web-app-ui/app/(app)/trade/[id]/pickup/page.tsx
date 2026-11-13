import type { Metadata } from 'next';
import { Pickup } from '../../../../../src/trade/delivery/Pickup';
import { DeliveryPage } from '../../../../../src/trade/delivery/page';

export const metadata: Metadata = { title: 'Delivery Details' };

/** F-028 (CWT-S11). */
export default function Page({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  return DeliveryPage({ params, render: (id) => <Pickup id={id} /> });
}
