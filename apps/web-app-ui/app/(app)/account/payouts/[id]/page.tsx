import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PayoutReceipt } from '../../../../../src/payouts/PayoutReceipt';
import { AccountScreen } from '../../../../../src/shell/AccountScreen';

export const metadata: Metadata = { title: 'Payout' };

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PR1 and WF1 (F-037): one payout, its receipt or why it didn't go through. */
export default async function PayoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return (
    <AccountScreen section="payouts">
      <PayoutReceipt id={id} />
    </AccountScreen>
  );
}
