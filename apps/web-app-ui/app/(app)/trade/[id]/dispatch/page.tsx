import type { Metadata } from 'next';
import { DispatchRoute } from '../../../../../src/trade/shipping/DispatchRoute';
import { DeliveryPage } from '../../../../../src/trade/delivery/page';

export const metadata: Metadata = { title: 'Ready to Dispatch' };

/** F-028 (CWT-S08) on a phone; DX-19 and TX-12, the dispatch workspace, from a tablet up (F-069, F-073). */
export default function Page({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  return DeliveryPage({ params, render: (id) => <DispatchRoute id={id} /> });
}
