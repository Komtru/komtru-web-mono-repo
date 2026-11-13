import type { Metadata } from 'next';
import { Track } from '../../../../../src/trade/delivery/Track';
import { DeliveryPage } from '../../../../../src/trade/delivery/page';

export const metadata: Metadata = { title: 'Track Order' };

/** F-028 (CWT-S10). */
export default function Page({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  return DeliveryPage({ params, render: (id) => <Track id={id} /> });
}
