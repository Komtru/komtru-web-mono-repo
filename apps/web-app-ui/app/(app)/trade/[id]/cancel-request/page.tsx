import type { Metadata } from 'next';
import { ReviewRequest } from '../../../../../src/trade/cancel/ReviewRequest';
import { DeliveryPage } from '../../../../../src/trade/delivery/page';

export const metadata: Metadata = { title: 'Cancellation request' };

/** F-030 (CR2): the seller answers the buyer's cancellation request. */
export default function Page({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  return DeliveryPage({ params, render: (id) => <ReviewRequest id={id} /> });
}
