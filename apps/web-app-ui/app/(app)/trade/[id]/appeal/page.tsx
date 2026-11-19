import type { Metadata } from 'next';
import { DeliveryPage } from '../../../../../src/trade/delivery/page';
import { Appeal } from '../../../../../src/trade/dispute/Appeal';
import { WithDispute } from '../../../../../src/trade/dispute/DisputeScreen';

/** F-032 (AC6). */
export const metadata: Metadata = { title: 'File an appeal' };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return DeliveryPage({
    params,
    render: (id) => (
      <WithDispute
        id={id}
        title="File an Appeal"
        render={(disputeId) => <Appeal id={id} disputeId={disputeId} />}
      />
    ),
  });
}
