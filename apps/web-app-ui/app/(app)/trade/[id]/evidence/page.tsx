import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppShell } from '../../../../../src/shell/AppShell';
import { resolveMode, resolveViewer } from '../../../../../src/shell/viewer';
import { EvidenceTrail } from '../../../../../src/trade/proof/EvidenceTrail';

export const metadata: Metadata = { title: 'Trade Evidence' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** F-029 PM-6: the evidence trail, what was shown, added and by whom. A static route, so it takes precedence over `/trade/[id]/[tab]`. */
export default async function EvidenceTrailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);

  return (
    <AppShell tab="trades" viewer={viewer} mode={mode}>
      <EvidenceTrail id={id} />
    </AppShell>
  );
}
