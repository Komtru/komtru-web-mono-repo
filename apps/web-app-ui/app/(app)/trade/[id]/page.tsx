import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppShell } from '../../../../src/shell/AppShell';
import { resolveMode, resolveViewer } from '../../../../src/shell/viewer';
import { TradeScreen } from '../../../../src/trade/TradeScreen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: 'Trade' };

/**
 * Where a proposal is read and answered: R1, Customer-2, G3, IF1, TC-06 and the waiting and closed
 * states are all this route, because which one a person sees depends on the trade's state and on
 * which side they are, and both come from the backend.
 */
export default async function TradePage({
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
      <TradeScreen id={id} />
    </AppShell>
  );
}
