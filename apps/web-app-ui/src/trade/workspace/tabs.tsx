'use client';

import type { TradeView } from '@komtru/api-client';
import type { TradeRole, WorkspaceStatus, WorkspaceTab } from '../workspace-state';
import { ActionsTab } from './ActionsTab';
import { ActivityTab } from './ActivityTab';
import { Overview } from './overview';
import { TermsTab } from './TermsTab';

export interface TabProps {
  trade: TradeView;
  status: WorkspaceStatus;
  role: TradeRole;
}

/**
 * The content of each tab, keyed by the ids in `WORKSPACE_TAB_DEFS`. `satisfies Record<WorkspaceTab, ...>`
 * makes the registry as exhaustive as the list: add a tab there and this does not compile until it has a
 * component, and a component here with no entry there does not either. A later feature adds both and edits
 * nothing else in the workspace.
 */
export const TAB_CONTENT = {
  overview: (props) => <Overview {...props} />,
  terms: ({ trade }) => <TermsTab trade={trade} />,
  activity: ({ trade }) => <ActivityTab trade={trade} />,
  actions: (props) => <ActionsTab {...props} />,
} satisfies Record<WorkspaceTab, (props: TabProps) => React.JSX.Element>;
