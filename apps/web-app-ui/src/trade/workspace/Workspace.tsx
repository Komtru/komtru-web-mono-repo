'use client';

import type { TradeView } from '@komtru/api-client';
import { ScreenColumn, ScreenHeader, TabNav, TradeRow } from '@komtru/ui-kit';
import { initialsOf, itemTitle, nairaShort, partyName } from '../format';
import {
  tabHref,
  tabItems,
  tabTitle,
  workspaceStanding,
  type WorkspaceStatus,
  type WorkspaceTab,
} from '../workspace-state';
import { RailShowsMoney } from './shared';
import { TAB_CONTENT } from './tabs';
import { useViewport } from './viewport';
import { ContextRail, StageTimeline, TradePane } from './wide';

/**
 * The trade, from the agreement onward: the one screen every later trade feature renders a tab or a sheet
 * inside. It is ONE surface for both people. The trade says which side the reader is (`yourRole`), and the words
 * come from `workspace-copy.ts` and the rules from `workspace-state.ts`, both as pure functions of that side;
 * there is no buyer's workspace and seller's workspace to keep in step.
 *
 * What is true comes from the platform. Keeping it current is `TradeScreen`'s job (it listens for every stage
 * of a trade, not only this one).
 */
export function Workspace({
  trade,
  status,
  tab,
}: {
  trade: TradeView;
  status: WorkspaceStatus;
  tab: WorkspaceTab;
}): React.JSX.Element {
  const standing = workspaceStanding(status);
  const counterparty = trade.counterparty;
  const name = counterparty === undefined || counterparty === null ? undefined : partyName(counterparty);
  const overview = tab === 'overview';
  const item = trade.terms === null ? undefined : itemTitle(trade.terms.itemSpec);

  const viewport = useViewport();
  const detail = (
    <>
      {/* The overview is the trade itself, headed by its code; the other tabs are views of it with their own
          titles (as the reference draws them) and a way back to it. */}
      <ScreenHeader
        title={overview ? trade.tradeCode : tabTitle(tab)}
        backHref={overview ? '/trades' : tabHref(trade.id, 'overview')}
        backLabel={overview ? 'Back to your trades' : 'Back to the trade'}
      />
      {overview && (
        <TradeRow
          amount={trade.terms === null ? '—' : nairaShort(trade.terms.itemAmountMinor)}
          status={standing.chip}
          {...(name === undefined && item === undefined
            ? {}
            : {
                counterparty: {
                  name: [item, name].filter((part): part is string => part !== undefined).join(' · '),
                  initials: initialsOf((name ?? item ?? '').replace(/^@/, '')),
                },
              })}
          {...(standing.stage === undefined ? {} : { stage: standing.stage })}
          className="mb-[14px]"
        />
      )}
      <TabNav aria-label="Trade views" items={tabItems(trade.id)} current={tab} />
      {TAB_CONTENT[tab]({ trade, status, role: trade.yourRole })}
    </>
  );

  if (viewport === 'mobile') return <ScreenColumn>{detail}</ScreenColumn>;

  // DX-21 and TX-13: the list of trades never leaves. On a tablet the money and evidence stack under the detail; on a
  // desktop they are a rail of their own and the timeline joins the detail.
  const rail = <ContextRail trade={trade} status={status} />;
  return (
    <div
      data-workspace={viewport}
      className={
        viewport === 'desktop'
          ? 'grid grid-cols-[260px_minmax(0,1fr)_300px] items-start gap-[20px]'
          : 'grid grid-cols-[240px_minmax(0,1fr)] items-start gap-[16px]'
      }
    >
      <TradePane currentId={trade.id} currentClosed={standing.closed} />
      <div className="min-w-0">
        <RailShowsMoney.Provider value>{detail}</RailShowsMoney.Provider>
        {viewport === 'desktop' && overview && (
          <div className="mt-[16px]">
            <StageTimeline trade={trade} status={status} />
          </div>
        )}
        {viewport === 'tablet' && <div className="mt-[16px]">{rail}</div>}
      </div>
      {viewport === 'desktop' && rail}
    </div>
  );
}
