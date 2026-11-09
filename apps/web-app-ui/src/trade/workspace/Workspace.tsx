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
import { TAB_CONTENT } from './tabs';

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

  return (
    <ScreenColumn>
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
    </ScreenColumn>
  );
}
