import type { Metadata } from 'next';
import { AppShell } from '../../../src/shell/AppShell';
import { Placeholder } from '../../../src/shell/Placeholder';
import { resolveMode, resolveViewer } from '../../../src/shell/viewer';

export const metadata: Metadata = { title: 'Messages' };

/** AC7 and the trade-scoped conversations: T-128 builds what goes inside the shell. */
export default async function MessagesPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);

  return (
    <AppShell mode={mode} tab="messages" viewer={viewer}>
      <Placeholder
        title="No conversations yet"
        body="Every message is attached to a trade, so what was agreed stays with the trade it was agreed on."
      />
    </AppShell>
  );
}
