import type { Metadata } from 'next';
import { AppShell } from '../../../../src/shell/AppShell';
import { resolveViewer } from '../../../../src/shell/viewer';
import { BuyerStart } from '../../../../src/trade/create/BuyerStart';
import { SellerStart } from '../../../../src/trade/create/SellerStart';
import { SideChoice, sideOf } from '../../../../src/trade/create/SideChoice';

export const metadata: Metadata = { title: 'Start Trade' };

/**
 * Start Trade. `?side=` says which side the person creating the trade is on: `buy` is the buyer's
 * four-stage request (CT-B1 to CT-B5), `sell` the seller's (CT-S1 to CT-S5). Without it they are asked
 * first (owner ruling 2026-11-20: there is no Buy/Sell mode to read it from). `?with=` names the other
 * party in advance and is kept through the choice.
 */
export default async function StartTradePage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string | string[]; with?: string | string[] }>;
}): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const { side: rawSide, with: other } = await searchParams;
  const side = sideOf(rawSide);
  const counterparty = typeof other === 'string' ? { counterparty: other } : {};

  return (
    <AppShell tab="trades" viewer={viewer}>
      {side === 'sell' ? (
        <SellerStart {...counterparty} />
      ) : side === 'buy' ? (
        <BuyerStart {...counterparty} />
      ) : (
        <SideChoice {...counterparty} />
      )}
    </AppShell>
  );
}
