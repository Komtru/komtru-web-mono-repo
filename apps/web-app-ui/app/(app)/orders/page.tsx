import type { Metadata } from 'next';
import { AppShell } from '../../../src/shell/AppShell';
import { resolveMode, resolveViewer } from '../../../src/shell/viewer';
import { ActiveOrders } from '../../../src/trade/ActiveOrders';

export const metadata: Metadata = { title: 'Orders' };

/** AC8, Sell mode's Orders tab: the seller's orders by custody stage. */
export default async function OrdersPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);

  return (
    <AppShell tab="orders" viewer={viewer} mode={mode}>
      <ActiveOrders />
    </AppShell>
  );
}
