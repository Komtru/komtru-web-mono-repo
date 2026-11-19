import type { Metadata } from 'next';
import { DeliveryPage } from '../../../../../src/trade/delivery/page';
import { WithDispute } from '../../../../../src/trade/dispute/DisputeScreen';
import { IssueReview } from '../../../../../src/trade/dispute/IssueReview';

/** F-032 (DI-01). */
export const metadata: Metadata = { title: 'Report an issue' };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return DeliveryPage({
    params,
    render: (id) => (
      <WithDispute
        id={id}
        title="Report an Issue"
        render={(disputeId) => <IssueReview id={id} disputeId={disputeId} />}
      />
    ),
  });
}
