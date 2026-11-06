import type { Metadata } from 'next';
import { AppShell } from '../../../src/shell/AppShell';
import { Placeholder } from '../../../src/shell/Placeholder';
import { resolveMode, resolveViewer } from '../../../src/shell/viewer';

export const metadata: Metadata = { title: 'Home' };

/** DX-03, the Buy mode landing screen: what needs attention first. T-207 builds what goes inside the shell. */
export default async function HomePage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);

  return (
    <AppShell tab="home" viewer={viewer} mode={mode}>
      <Placeholder title="Your trades, at a glance" body="Everything that needs your attention, first." />
    </AppShell>
  );
}
