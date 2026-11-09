import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppShell } from '../../../../../src/shell/AppShell';
import { resolveMode, resolveViewer } from '../../../../../src/shell/viewer';
import { TradeScreen } from '../../../../../src/trade/TradeScreen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: 'Trade Actions' };

/**
 * CWT-09: what the person can do with the trade now, from its state and their side of it.
 * The same screen as `/trade/[id]`, on the tab its address names: one trade screen decides what each
 * stage looks like, so a tab is not a second screen to keep in step.
 */
export default async function TradeTabPage({
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
      <TradeScreen id={id} tab="actions" />
    </AppShell>
  );
}
