import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppShell } from '../../../../../src/shell/AppShell';
import { resolveMode, resolveViewer } from '../../../../../src/shell/viewer';
import { Inspect } from '../../../../../src/trade/inspection/Inspect';

export const metadata: Metadata = { title: 'Inspect & Confirm' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * F-027 (Customer-4, Z4, Z5, BEI1, BEI2): inspect, confirm and release; the seller answers more time. A static route, so it takes precedence over
 * `/trade/[id]/[tab]`.
 */
export default async function InspectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);

  return (
    <AppShell mode={mode} tab="trades" viewer={viewer}>
      <Inspect id={id} />
    </AppShell>
  );
}
