import type { Metadata } from 'next';
import { AppShell } from '../../src/shell/AppShell';
import { Placeholder } from '../../src/shell/Placeholder';
import { resolveViewer } from '../../src/shell/viewer';

export const metadata: Metadata = { title: 'Explore' };

/** Search, categories and seller discovery: T-113 builds what goes inside the shell. */
export default async function ExplorePage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();

  return (
    <AppShell tab="explore" viewer={viewer}>
      <Placeholder
        title="Find a seller or an item"
        body="Search by item, seller or category. Ranking follows verification and fulfilment history, never paid placement."
      />
    </AppShell>
  );
}
