import type { Metadata } from 'next';
import { AppShell } from '../../../src/shell/AppShell';
import { Placeholder } from '../../../src/shell/Placeholder';
import { resolveViewer } from '../../../src/shell/viewer';

export const metadata: Metadata = { title: 'Shop' };

/**
 * A certified merchant's storefront, listings and insights (T-122, T-125). It takes Explore's place
 * in the tab bar rather than adding a tab, because a certified merchant cannot buy (design §6.3).
 *
 * Someone without certification can still reach this URL, and for them Shop is not one of their
 * five destinations — so no tab is marked, and the screen says what Shop is for and what opens it.
 * Claiming a tab the person's own tab bar does not have would put `aria-current="page"` on nothing.
 */
export default async function ShopPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();

  return (
    <AppShell {...(viewer.certifiedMerchant ? { tab: 'shop' as const } : {})} viewer={viewer}>
      {viewer.certifiedMerchant ? (
        <Placeholder
          title="Your shop lives here"
          body="Your storefront, your listings and how they are performing."
        />
      ) : (
        <Placeholder
          title="Shop opens with merchant certification"
          body="Certified merchants get a storefront, listings and insights in place of Explore. Apply from Account, and we'll tell you when it's approved."
        />
      )}
    </AppShell>
  );
}
