import type { Metadata } from 'next';
import { AppShell } from '../../../../src/shell/AppShell';
import { resolveMode, resolveViewer } from '../../../../src/shell/viewer';
import { BuyerStart } from '../../../../src/trade/create/BuyerStart';
import { SellerStart } from '../../../../src/trade/create/SellerStart';
import { SideChoice, sideOf } from '../../../../src/trade/create/SideChoice';

export const metadata: Metadata = { title: 'Start Trade' };

/**
 * Start Trade. `?side=` says which side the person creating the trade is on: `buy` is the buyer's
 * four-stage request (CT-B1 to CT-B5), `sell` the seller's (CT-S1 to CT-S5). Without it they are asked
 * first, always (owner ruling 2026-11-22), with the side of the mode they are in already picked: the mode
 * is what they are looking at, not which side of this trade they are on. `?with=` names the other party
 * in advance and is kept through the choice.
 */
export default async function StartTradePage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string | string[]; with?: string | string[] }>;
}): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);
  const { side: rawSide, with: other } = await searchParams;
  const side = sideOf(rawSide);
  const counterparty = typeof other === 'string' ? { counterparty: other } : {};

  return (
    <AppShell mode={mode} tab="trades" viewer={viewer}>
      {side === 'sell' ? (
        <SellerStart {...counterparty} />
      ) : side === 'buy' ? (
        <BuyerStart {...counterparty} />
      ) : (
        <SideChoice picked={mode} {...counterparty} />
      )}
    </AppShell>
  );
}
