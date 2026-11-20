import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppShell } from '../../../../../src/shell/AppShell';
import { resolveViewer } from '../../../../../src/shell/viewer';
import { RequestMoreTime } from '../../../../../src/trade/shipping/RequestMoreTime';

export const metadata: Metadata = { title: 'Request more time' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * F-027 (DE1): the seller asks the buyer for more time to deliver. A static route, so it takes precedence over
 * `/trade/[id]/[tab]`.
 */
export default async function RequestMoreTimePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const viewer = await resolveViewer();

  return (
    <AppShell tab="trades" viewer={viewer}>
      <RequestMoreTime id={id} />
    </AppShell>
  );
}
