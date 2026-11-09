import type { Metadata } from 'next';
import { AppShell } from '../../../../src/shell/AppShell';
import { resolveMode, resolveViewer } from '../../../../src/shell/viewer';
import { StartTrade } from '../../../../src/trade/StartTrade';

export const metadata: Metadata = { title: 'Start Trade' };

/** I3. Buy mode starts a purchase and Sell mode a sale; `?with=` names the other party in advance. */
export default async function StartTradePage({
  searchParams,
}: {
  searchParams: Promise<{ with?: string | string[] }>;
}): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);
  const { with: other } = await searchParams;

  return (
    <AppShell tab="trades" viewer={viewer} mode={mode}>
      <StartTrade
        defaultRole={mode === 'sell' ? 'SELLER' : 'BUYER'}
        {...(typeof other === 'string' ? { counterparty: other } : {})}
      />
    </AppShell>
  );
}
