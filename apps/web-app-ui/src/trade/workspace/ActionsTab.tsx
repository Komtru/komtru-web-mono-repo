'use client';

import type { TradeView } from '@komtru/api-client';
import { ActionStack, Button, InfoCard, InfoRow } from '@komtru/ui-kit';
import { cancelHref, tabHref, tradeActions, type TradeRole, type WorkspaceStatus } from '../workspace-state';

/** CWT-09: what the person can do with the trade now, from its state and their side of it. */
export function ActionsTab({
  trade,
  status,
  role,
}: {
  trade: TradeView;
  status: WorkspaceStatus;
  role: TradeRole;
}): React.JSX.Element {
  const rows = tradeActions(status, role, trade.id);
  const canWithdraw = rows.some((row) => row.id === 'cancel');

  return (
    <>
      <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
        What you can do depends on where the trade is and which side you are on.
      </p>
      <InfoCard aria-label="Actions on this trade">
        {rows.map((row) => (
          <InfoRow
            key={row.id}
            title={row.title}
            detail={row.availability === 'later' ? `${row.description} Not in the app yet.` : row.description}
            {...(row.href === undefined ? {} : { href: row.href })}
          />
        ))}
      </InfoCard>
      <ActionStack>
        {canWithdraw && (
          // CT1: withdrawing is its own screen now, so the payment status is read before the cancel is offered.
          <Button asChild variant="ghost">
            <a href={cancelHref(trade.id)}>Withdraw from this trade</a>
          </Button>
        )}
        <Button asChild variant="secondary">
          <a href={tabHref(trade.id, 'overview')}>View current trade</a>
        </Button>
        <Button asChild variant="secondary">
          <a href={tabHref(trade.id, 'activity')}>Open trade activity</a>
        </Button>
      </ActionStack>
    </>
  );
}
