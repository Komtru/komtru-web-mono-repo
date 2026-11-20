import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppShell } from '../../../../../src/shell/AppShell';
import { resolveViewer } from '../../../../../src/shell/viewer';
import { CompleteRequest } from '../../../../../src/trade/create/CompleteRequest';

export const metadata: Metadata = { title: 'Complete the Details' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * F-018 (CT-B7 to CT-B9): the seller completes a buyer's request. A static route, so it takes precedence over
 * `/trade/[id]/[tab]`.
 */
export default async function CompleteRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const viewer = await resolveViewer();

  return (
    <AppShell tab="trades" viewer={viewer}>
      <CompleteRequest id={id} />
    </AppShell>
  );
}
