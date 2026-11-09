import type { Metadata } from 'next';
import { AppShell } from '../../../src/shell/AppShell';
import { resolveMode, resolveViewer } from '../../../src/shell/viewer';
import { MyTrades } from '../../../src/trade/MyTrades';

export const metadata: Metadata = { title: 'Trades' };

/**
 * OF1, C1 and Q1's route: every trade the person is part of, as buyer or seller, with what to do next
 * on each. `?code=` is the Trade Code bar's destination.
 */
export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);
  const { code } = await searchParams;

  return (
    <AppShell tab="trades" viewer={viewer} mode={mode}>
      <MyTrades {...(typeof code === 'string' ? { code } : {})} />
    </AppShell>
  );
}
