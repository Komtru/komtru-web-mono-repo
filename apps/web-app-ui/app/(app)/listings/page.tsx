import type { Metadata } from 'next';
import { AppShell } from '../../../src/shell/AppShell';
import { Placeholder } from '../../../src/shell/Placeholder';
import { resolveMode, resolveViewer } from '../../../src/shell/viewer';

export const metadata: Metadata = { title: 'Listings' };

/** DX-20, Sell mode: the listings someone has for sale. T-209 builds what goes inside the shell. */
export default async function ListingsPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);

  return (
    <AppShell tab="listings" viewer={viewer} mode={mode}>
      <Placeholder
        title="Your listings will appear here"
        body="What you have for sale, and how each listing is doing."
      />
    </AppShell>
  );
}
