import type { Metadata } from 'next';
import { DeliveryPage } from '../../../../../src/trade/delivery/page';
import { DisputeScreen } from '../../../../../src/trade/dispute/DisputeScreen';

/** F-032 (Customer-7, Seller-7, CWT-S14). */
export const metadata: Metadata = { title: 'Report an issue' };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return DeliveryPage({ params, render: (id) => <DisputeScreen id={id} /> });
}
