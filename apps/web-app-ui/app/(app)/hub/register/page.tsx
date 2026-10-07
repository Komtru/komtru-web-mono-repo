import type { Metadata } from 'next';
import { AppShell } from '../../../../src/shell/AppShell';
import { Placeholder } from '../../../../src/shell/Placeholder';
import { resolveViewer } from '../../../../src/shell/viewer';

export const metadata: Metadata = { title: 'Register a Park Hub' };

/**
 * PH1–PH5, reached from Account's Park Agent row. The application stays in this app under the
 * consumer session; only the operating screens moved to `park.komtru.com` (design C12, §7.6), which
 * is what `middleware` enforces for every other `/hub/*` path.
 *
 * T-130 builds the five steps. No tab is marked: this is a flow reached from Account, not a tab.
 */
export default async function HubRegisterPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();

  return (
    <AppShell viewer={viewer}>
      <Placeholder
        title="Register a Park Hub"
        body="Turn a motor park terminal into a Komtru custody point: every parcel logged, inspected, and released only against a matching PIN."
      />
    </AppShell>
  );
}
