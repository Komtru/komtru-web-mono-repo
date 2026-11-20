import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppShell } from '../../../../../src/shell/AppShell';
import { resolveViewer } from '../../../../../src/shell/viewer';
import { TradeCompleted } from '../../../../../src/trade/complete/TradeCompleted';

export const metadata: Metadata = { title: 'Trade Completed' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * F-069 (DX-31): the result of a completed trade, and what it added to the person's record. A static route, so it
 * takes precedence over `/trade/[id]/[tab]`. It is `/completed`, not `/complete`: that is the seller finishing a
 * buyer's request (F-018).
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const viewer = await resolveViewer();

  return (
    <AppShell tab="trades" viewer={viewer}>
      <TradeCompleted id={id} />
    </AppShell>
  );
}
