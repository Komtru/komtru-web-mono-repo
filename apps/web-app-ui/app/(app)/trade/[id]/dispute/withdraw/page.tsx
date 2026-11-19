import type { Metadata } from 'next';
import { DeliveryPage } from '../../../../../../src/trade/delivery/page';
import { WithDispute } from '../../../../../../src/trade/dispute/DisputeScreen';
import { Withdraw } from '../../../../../../src/trade/dispute/Withdraw';

/** F-032 (SP-M23). */
export const metadata: Metadata = { title: 'Withdraw a dispute' };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return DeliveryPage({
    params,
    render: (id) => (
      <WithDispute
        id={id}
        title="Withdraw"
        render={(disputeId) => <Withdraw id={id} disputeId={disputeId} />}
      />
    ),
  });
}
