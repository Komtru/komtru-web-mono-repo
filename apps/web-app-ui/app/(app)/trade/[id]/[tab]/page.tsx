import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppShell } from '../../../../../src/shell/AppShell';
import { resolveViewer } from '../../../../../src/shell/viewer';
import { TradeScreen } from '../../../../../src/trade/TradeScreen';
import { isWorkspaceTab, tabTitle } from '../../../../../src/trade/workspace-state';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Promise<{ id: string; tab: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { tab } = await params;
  return { title: isWorkspaceTab(tab) ? tabTitle(tab) : 'Trade' };
}

/**
 * Every tab of a trade (CWT-07 `/terms`, CWT-08 `/activity`, CWT-09 `/actions`, and whatever a later feature adds
 * to `WORKSPACE_TAB_DEFS`) is this one route: the same screen as `/trade/[id]`, on the tab its address names.
 * The overview is the trade's own address, so `/overview` is not one. `/trade/[id]/counter` is its own static
 * route and takes precedence over this one.
 */
export default async function TradeTabPage({ params }: { params: Params }): Promise<React.JSX.Element> {
  const { id, tab } = await params;
  if (!UUID.test(id) || !isWorkspaceTab(tab) || tab === 'overview') notFound();
  const viewer = await resolveViewer();

  return (
    <AppShell tab="trades" viewer={viewer}>
      <TradeScreen id={id} tab={tab} />
    </AppShell>
  );
}
