import type { Metadata } from 'next';
import { AppShell } from '../../../../src/shell/AppShell';
import { resolveMode, resolveViewer } from '../../../../src/shell/viewer';
import { SellLive } from '../../../../src/sell/Live';

export const metadata: Metadata = { title: 'Your shop is live' };

/** SO5 (T-121): the shop is live. Inside the app shell, with Shop as the current tab, as the reference draws it. */
export default async function SellLivePage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);

  return (
    <AppShell tab="shop" viewer={viewer} mode={mode}>
      <SellLive />
    </AppShell>
  );
}
