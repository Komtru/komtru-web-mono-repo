import type { Metadata } from 'next';
import { AppShell } from '../../../src/shell/AppShell';
import { resolveViewer } from '../../../src/shell/viewer';
import { MyTrades } from '../../../src/trade/MyTrades';

export const metadata: Metadata = { title: 'Trades' };

/** OF1, C1 and Q1's route: every trade the person is part of, as buyer or seller, with what to do next. */
export default async function TradesPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();

  return (
    <AppShell tab="trades" viewer={viewer}>
      <MyTrades />
    </AppShell>
  );
}
