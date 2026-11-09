'use client';

import type { WorkspaceStatus } from '../workspace-state';
import type { BodyProps } from './shared';
import { DeliveryToConfirm, InTransit } from './states/Delivery';
import { Disputed, Outcome, Settlement, TradeComplete } from './states/Ending';
import { AwaitingFunding, FundsProtected } from './states/Funding';
import { Inspection } from './states/Inspection';

/**
 * The overview of a trade at each status. EXHAUSTIVE on purpose: there is no default, so adding a status to
 * `WORKSPACE_STATUSES` does not compile until it has a body here (a later feature that adds a state is told).
 * F-024, F-026, F-027 and F-032 each replace the seam in the body of their own state, in its own file.
 */
export function Overview({
  trade,
  role,
  status,
}: BodyProps & { status: WorkspaceStatus }): React.JSX.Element {
  switch (status) {
    case 'PENDING_PAYMENT':
      return <AwaitingFunding trade={trade} role={role} />;
    case 'FUNDED':
      return <FundsProtected trade={trade} role={role} />;
    case 'SHIPPED':
      return <InTransit trade={trade} role={role} />;
    case 'UNCONFIRMED_DELIVERY':
      return <DeliveryToConfirm trade={trade} role={role} />;
    case 'INSPECTION':
      return <Inspection trade={trade} role={role} />;
    case 'DISPUTED':
      return <Disputed trade={trade} role={role} />;
    case 'COMPLETED':
      return <Settlement trade={trade} role={role} />;
    case 'SETTLED':
      return <TradeComplete trade={trade} role={role} />;
    case 'RESOLVED_RELEASED':
    case 'RESOLVED_REFUNDED':
    case 'CANCELLED_REFUNDED':
      return <Outcome trade={trade} role={role} status={status} />;
  }
}
