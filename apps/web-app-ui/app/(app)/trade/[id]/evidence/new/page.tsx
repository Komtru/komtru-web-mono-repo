import type { Metadata } from 'next';
import { AddEvidence } from '../../../../../../src/trade/delivery/AddEvidence';
import { DeliveryPage } from '../../../../../../src/trade/delivery/page';

export const metadata: Metadata = { title: 'Add Evidence' };

/** F-028 (CWT-S13). */
export default function Page({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  return DeliveryPage({ params, render: (id) => <AddEvidence id={id} /> });
}
