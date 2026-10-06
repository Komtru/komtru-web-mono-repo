import type { Metadata } from 'next';
import { AppShell } from '../../src/shell/AppShell';
import { Placeholder } from '../../src/shell/Placeholder';
import { resolveViewer } from '../../src/shell/viewer';

export const metadata: Metadata = { title: 'Shop' };

/**
 * A certified merchant's storefront, listings and insights (T-122, T-125). It takes Explore's place
 * in the tab bar rather than adding a tab, because a certified merchant cannot buy (design §6.3).
 */
export default async function ShopPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();

  return (
    <AppShell tab="shop" viewer={viewer}>
      <Placeholder
        title="Your shop lives here"
        body="Storefront, listings and how they are performing — once your merchant certification is approved."
      />
    </AppShell>
  );
}
