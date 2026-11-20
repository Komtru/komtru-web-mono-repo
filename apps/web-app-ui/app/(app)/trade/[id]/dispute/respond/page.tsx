import type { Metadata } from 'next';
import { DeliveryPage } from '../../../../../../src/trade/delivery/page';
import { WithDispute } from '../../../../../../src/trade/dispute/DisputeScreen';

/** F-032 (Seller-8): the seller's response, reached from the dispute notice. */
export const metadata: Metadata = { title: 'Your response' };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return DeliveryPage({
    params,
    render: (id) => <WithDispute id={id} screen="respond" />,
  });
}
