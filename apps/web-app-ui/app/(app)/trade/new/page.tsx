import type { Metadata } from 'next';
import { AppShell } from '../../../../src/shell/AppShell';
import { resolveMode, resolveViewer } from '../../../../src/shell/viewer';
import { BuyerStart } from '../../../../src/trade/create/BuyerStart';
import { SellerStart } from '../../../../src/trade/create/SellerStart';

export const metadata: Metadata = { title: 'Start Trade' };

/**
 * Buy mode is the buyer's four-stage request (CT-B1 to CT-B5); Sell mode is the seller's (CT-S1 to CT-S5). `?with=` names the other party in advance.
 */
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
      {mode === 'sell' ? (
        <SellerStart {...(typeof other === 'string' ? { counterparty: other } : {})} />
      ) : (
        <BuyerStart {...(typeof other === 'string' ? { counterparty: other } : {})} />
      )}
    </AppShell>
  );
}
