'use client';

import type { TradeView } from '@komtru/api-client';
import { useCancelTrade } from '@komtru/api-client/react';
import { ActionStack, Button, InfoCard, InfoRow, RiskBanner } from '@komtru/ui-kit';
import { useState } from 'react';
import { problemMessage } from '../format';
import { ConfirmSheet } from '../parts';
import { tabHref, tradeActions, type TradeRole, type WorkspaceStatus } from '../workspace-state';

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
  const cancel = useCancelTrade();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const rows = tradeActions(status, role, trade.id);
  const canWithdraw = rows.some((row) => row.id === 'cancel');

  const onWithdraw = () => {
    setProblem(undefined);
    cancel.mutate(
      { id: trade.id },
      {
        // The trade is now cancelled; the screen re-renders as the closed trade, so nothing to close here.
        onSuccess: () => setConfirming(false),
        onError: (error) => {
          setConfirming(false);
          setProblem(problemMessage(error, "We couldn't withdraw from the trade. Try again."));
        },
      },
    );
  };

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
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        {canWithdraw && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Withdraw from this trade
          </Button>
        )}
        <Button asChild variant="secondary">
          <a href={tabHref(trade.id, 'overview')}>View current trade</a>
        </Button>
        <Button asChild variant="secondary">
          <a href={tabHref(trade.id, 'activity')}>Open trade activity</a>
        </Button>
      </ActionStack>
      <ConfirmSheet
        open={confirming}
        title="Withdraw from this trade"
        confirm="Withdraw"
        pending={cancel.isPending}
        onConfirm={onWithdraw}
        onClose={() => {
          setConfirming(false);
        }}
      >
        <p className="text-[12.5px] leading-[1.5] text-slate">
          This ends the trade for both of you. Nothing has been paid, so nothing is charged.
        </p>
      </ConfirmSheet>
    </>
  );
}
