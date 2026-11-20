import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppShell } from '../../../../../src/shell/AppShell';
import { resolveViewer } from '../../../../../src/shell/viewer';
import { ShipOrder } from '../../../../../src/trade/shipping/ShipOrder';

export const metadata: Metadata = { title: 'Ship Order' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * F-026 (Seller-3, X1, X2): the seller ships a funded trade. A static route, so it takes precedence over
 * `/trade/[id]/[tab]`.
 */
export default async function ShipOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const viewer = await resolveViewer();

  return (
    <AppShell tab="trades" viewer={viewer}>
      <ShipOrder id={id} />
    </AppShell>
  );
}
