import { notFound } from 'next/navigation';
import { AppShell } from '../../shell/AppShell';
import { resolveViewer } from '../../shell/viewer';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The route wrapper every F-028 sheet shares: the trade id from the address, the signed-in shell around it.
 * Each is a static route, so it takes precedence over `/trade/[id]/[tab]`.
 */
export async function DeliveryPage({
  params,
  render,
}: {
  params: Promise<{ id: string }>;
  render: (id: string) => React.ReactNode;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const viewer = await resolveViewer();
  return (
    <AppShell tab="trades" viewer={viewer}>
      {render(id)}
    </AppShell>
  );
}
