import type { Metadata } from 'next';
import { HomeScreen } from '../../../src/home/HomeScreen';
import { ShopKpis } from '../../../src/home/ShopKpis';
import { AppShell } from '../../../src/shell/AppShell';
import { resolveMode, resolveViewer } from '../../../src/shell/viewer';

export const metadata: Metadata = { title: 'Shop' };

/**
 * Sell mode's dashboard (F-083): Seller-1 and H-02 on a phone, DX-04 on desktop, TX-03 on tablet. The trades the
 * person is selling, under the shop's KPI strip. Reached in either mode: Buy's nav marks Home for it.
 */
export default async function ShopPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);

  return (
    <AppShell mode={mode} tab="shop" viewer={viewer}>
      <HomeScreen side="SELLER" header={<ShopKpis certifiedMerchant={viewer.certifiedMerchant} />} />
    </AppShell>
  );
}
