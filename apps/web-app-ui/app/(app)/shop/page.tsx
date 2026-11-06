import type { Metadata } from 'next';
import { AppShell } from '../../../src/shell/AppShell';
import { Placeholder } from '../../../src/shell/Placeholder';
import { resolveMode, resolveViewer } from '../../../src/shell/viewer';

export const metadata: Metadata = { title: 'Shop' };

/**
 * DX-04, Sell mode's landing screen: the storefront, listings and insights (T-122, T-125, T-209).
 *
 * Shop is a Sell-mode destination. In Buy mode it is not one of the person's five, so no tab is
 * marked: claiming a tab the navigation does not have would put `aria-current="page"` on nothing.
 */
export default async function ShopPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);

  return (
    <AppShell {...(mode === 'sell' ? { tab: 'shop' as const } : {})} viewer={viewer} mode={mode}>
      <Placeholder
        title="Your selling activity"
        body="Your storefront, your listings and how they are performing."
      />
    </AppShell>
  );
}
