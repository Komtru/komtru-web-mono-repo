import type { Metadata } from 'next';
import { DeliveryPage } from '../../../../../../src/trade/delivery/page';
import { WithDispute } from '../../../../../../src/trade/dispute/DisputeScreen';

/** F-032 (Customer-8, CWT-S15, CWT-S18, H1, H2). */
export const metadata: Metadata = { title: 'Dispute' };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return DeliveryPage({
    params,
    render: (id) => <WithDispute id={id} screen="status" />,
  });
}
