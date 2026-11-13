import type { Metadata } from 'next';
import { Dispatch } from '../../../../../src/trade/delivery/Dispatch';
import { DeliveryPage } from '../../../../../src/trade/delivery/page';

export const metadata: Metadata = { title: 'Ready to Dispatch' };

/** F-028 (CWT-S08). */
export default function Page({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  return DeliveryPage({ params, render: (id) => <Dispatch id={id} /> });
}
