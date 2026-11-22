import type { Metadata } from 'next';
import { AppShell } from '../../../src/shell/AppShell';
import { resolveMode, resolveViewer } from '../../../src/shell/viewer';
import { MyTrades } from '../../../src/trade/MyTrades';

export const metadata: Metadata = { title: 'Trades' };

/**
 * OF1, C1 and Q1's route (F-083): in Buy, the trades the person is buying, with what to do next. Reached from Sell
 * (an old link), it lists what they are selling, the way Orders would.
 */
export default async function TradesPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);

  return (
    <AppShell mode={mode} tab="trades" viewer={viewer}>
      <MyTrades side={mode === 'sell' ? 'SELLER' : 'BUYER'} />
    </AppShell>
  );
}
