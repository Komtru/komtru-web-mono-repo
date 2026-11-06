import type { Metadata } from 'next';
import { AppShell } from '../../../src/shell/AppShell';
import { Placeholder } from '../../../src/shell/Placeholder';
import { resolveMode, resolveViewer } from '../../../src/shell/viewer';

export const metadata: Metadata = { title: 'Discover' };

/** Discover: search, categories and seller discovery: T-113 builds what goes inside the shell. */
export default async function BrowsePage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);

  return (
    <AppShell tab="discover" viewer={viewer} mode={mode}>
      <Placeholder
        title="Find a seller or an item"
        body="Search by item, seller or category. Ranking follows verification and fulfilment history, never paid placement."
      />
    </AppShell>
  );
}
