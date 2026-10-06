import type { Metadata } from 'next';
import { AppShell } from '../../src/shell/AppShell';
import { Placeholder } from '../../src/shell/Placeholder';
import { resolveViewer } from '../../src/shell/viewer';

export const metadata: Metadata = { title: 'Trades' };

/**
 * OF1 and C1's route. The shell, the offline state and the tab bar are this ticket's; the list of
 * trades is T-116's, which replaces what is inside the shell here.
 */
export default async function TradesPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();

  return (
    <AppShell tab="trades" viewer={viewer}>
      <Placeholder
        title="Your trades will appear here"
        body="Every trade you're part of — buying or selling — in one list, with what to do next on each."
      />
    </AppShell>
  );
}
