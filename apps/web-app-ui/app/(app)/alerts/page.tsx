import type { Metadata } from 'next';
import { AppShell } from '../../../src/shell/AppShell';
import { Placeholder } from '../../../src/shell/Placeholder';
import { resolveViewer } from '../../../src/shell/viewer';

export const metadata: Metadata = { title: 'Alerts' };

/** AC6 and the notification feed: T-120 and T-126 build what goes inside the shell. */
export default async function AlertsPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();

  return (
    <AppShell tab="alerts" viewer={viewer}>
      <Placeholder
        title="Nothing needs you right now"
        body="Funding, shipping, inspection windows and dispute updates land here as they happen."
      />
    </AppShell>
  );
}
