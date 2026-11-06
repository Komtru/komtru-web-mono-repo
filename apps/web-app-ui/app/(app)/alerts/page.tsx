import type { Metadata } from 'next';
import { AppShell } from '../../../src/shell/AppShell';
import { Placeholder } from '../../../src/shell/Placeholder';
import { resolveMode, resolveViewer } from '../../../src/shell/viewer';

export const metadata: Metadata = { title: 'Alerts' };

/** AC6 and the notification feed, reached from the bell in the top bar (v2: it is no longer a tab). T-120 and T-126 build what goes inside the shell. */
export default async function AlertsPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);

  return (
    <AppShell viewer={viewer} mode={mode}>
      <Placeholder
        title="Nothing needs you right now"
        body="Funding, shipping, inspection windows and dispute updates land here as they happen."
      />
    </AppShell>
  );
}
