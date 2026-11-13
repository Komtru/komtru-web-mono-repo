import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppShell } from '../../../../../src/shell/AppShell';
import { resolveMode, resolveViewer } from '../../../../../src/shell/viewer';
import { TradeRecord } from '../../../../../src/trade/proof/EvidenceTrail';

export const metadata: Metadata = { title: 'Trade Record' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** F-029 PM-8: the Trade record kept after completion. A static route, so it takes precedence over `/trade/[id]/[tab]`. */
export default async function TradeRecordPage({
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
      <TradeRecord id={id} />
    </AppShell>
  );
}
