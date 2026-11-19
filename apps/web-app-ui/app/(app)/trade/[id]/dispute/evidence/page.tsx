import type { Metadata } from 'next';
import { DeliveryPage } from '../../../../../../src/trade/delivery/page';
import { WithDispute } from '../../../../../../src/trade/dispute/DisputeScreen';

/** F-032 (Y1). Distinct from `/trade/[id]/evidence`, which is the trade's own media (CWT-S12). */
export const metadata: Metadata = { title: 'Evidence' };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return DeliveryPage({
    params,
    render: (id) => <WithDispute id={id} screen="evidence" />,
  });
}
