import type { Metadata } from 'next';
import { AppShell } from '../../../src/shell/AppShell';
import { Placeholder } from '../../../src/shell/Placeholder';
import { resolveMode, resolveViewer } from '../../../src/shell/viewer';

export const metadata: Metadata = { title: 'Orders' };

/** DX-18, Sell mode: orders to fulfil. T-209 builds what goes inside the shell. */
export default async function OrdersPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);

  return (
    <AppShell tab="orders" viewer={viewer} mode={mode}>
      <Placeholder
        title="Your orders will appear here"
        body="Orders to pack, dispatch and follow, with what to do next on each."
      />
    </AppShell>
  );
}
