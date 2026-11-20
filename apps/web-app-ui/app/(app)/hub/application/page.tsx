import type { Metadata } from 'next';
import { AppShell } from '../../../../src/shell/AppShell';
import { Placeholder } from '../../../../src/shell/Placeholder';
import { resolveViewer } from '../../../../src/shell/viewer';

export const metadata: Metadata = { title: 'Your hub application' };

/** PH6 and PA8 — the submitted, in-review and changes-requested states. T-130 builds them. */
export default async function HubApplicationPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();

  return (
    <AppShell viewer={viewer}>
      <Placeholder
        title="Your hub application"
        body="Where your application stands, and anything TrustOps has asked you to add before it can be approved."
      />
    </AppShell>
  );
}
