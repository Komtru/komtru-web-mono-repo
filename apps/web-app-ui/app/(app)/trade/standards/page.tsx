import type { Metadata } from 'next';
import { AppShell } from '../../../../src/shell/AppShell';
import { resolveMode, resolveViewer } from '../../../../src/shell/viewer';
import { TradeStandards } from '../../../../src/trade/TradeStandards';

export const metadata: Metadata = { title: 'Trade Standards' };

/** CTS1. The standards every trade in a category is held to. */
export default async function TradeStandardsPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);

  return (
    <AppShell mode={mode} tab="trades" viewer={viewer}>
      <TradeStandards />
    </AppShell>
  );
}
