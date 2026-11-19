'use client';

import { useTradeDispute } from '@komtru/api-client/react';
import { ActionStack, Button, SectionLabel, Skeleton, StatusHero, TermList, TermRow } from '@komtru/ui-kit';
import { AutoReleaseNotice } from '../../cancel/AutoReleaseNotice';
import { nairaShort, partyName } from '../../format';
import { ItemSummary } from '../../parts';
import { stateCopy } from '../../workspace-copy';
import type { WorkspaceStatus } from '../../workspace-state';
import { SubReadFailed } from '../../delivery/parts';
import { reasonLabel, stageLabel } from '../../dispute/words';
import { disputeStatusHref } from '../../workspace-state';
import { BannerView, FurtherViews, MoneyRows, type BodyProps } from '../shared';

/** The result of a trade that has been decided and is being or has been paid: its own screen (DX-31), a sibling of `/complete`. */
const completedHref = (tradeId: string): string => `/trade/${tradeId}/completed`;

/** The way to the result, shown once the outcome is known (COMPLETED) and after it is paid (SETTLED). */
function ViewTheResult({ id }: { id: string }): React.JSX.Element {
  return (
    <ActionStack>
      <Button asChild>
        <a href={completedHref(id)}>View the result</a>
      </Button>
    </ActionStack>
  );
}

/**
 * CWT-05: an issue was reported and the money stays where it is.
 *
 * F-032 closed the seam here. The case reference, its stage and the window it is waiting on are
 * read from the dispute; a failed read leaves the rest of the body standing and says so in one
 * line, because the banner above it is true whether or not the case details load.
 */
export function Disputed({ trade, role }: BodyProps): React.JSX.Element {
  const copy = stateCopy('DISPUTED', role);
  const dispute = useTradeDispute(trade.id);
  return (
    <>
      {copy.banner && <BannerView banner={copy.banner} />}
      <MoneyRows trade={trade} role={role} held={copy.payoutHeld ?? ''} />

      {dispute.isPending && <Skeleton lines={3} />}
      {dispute.isError && <SubReadFailed noun="the case" onRetry={() => void dispute.refetch()} />}
      {dispute.data !== null && dispute.data !== undefined && (
        <>
          <SectionLabel>The case</SectionLabel>
          <TermList aria-label="The case">
            <TermRow label="Case">{dispute.data.code}</TermRow>
            <TermRow label="Issue">{reasonLabel(dispute.data.category)}</TermRow>
            <TermRow label="Stage">{stageLabel(dispute.data.status)}</TermRow>
          </TermList>
          <ActionStack>
            <Button asChild>
              <a href={disputeStatusHref(trade.id)}>Open the case</a>
            </Button>
          </ActionStack>
        </>
      )}

      <FurtherViews trade={trade} />
    </>
  );
}

/** CWT-06: the outcome is known; the money has not finished moving. */
export function Settlement({ trade, role }: BodyProps): React.JSX.Element {
  const { fees } = trade;
  const copy = stateCopy('COMPLETED', role);
  const amount =
    fees === null
      ? ''
      : ` · ${nairaShort(role === 'BUYER' ? fees.itemAmountMinor : fees.sellerProceedsMinor)}`;
  return (
    <>
      <AutoReleaseNotice trade={trade} />
      {copy.banner && <BannerView banner={copy.banner} />}
      <SectionLabel>Financial outcome</SectionLabel>
      <TermList aria-label="Financial outcome">
        <TermRow label="Status">Processing{amount}</TermRow>
        <TermRow label="Trade outcome">Completed</TermRow>
        <TermRow label="Payment instruction">Release to seller</TermRow>
      </TermList>
      <ViewTheResult id={trade.id} />
      <FurtherViews trade={trade} />
    </>
  );
}

/** Customer-5: done, paid out. */
export function TradeComplete({ trade, role }: BodyProps): React.JSX.Element {
  const { fees } = trade;
  const copy = stateCopy('SETTLED', role, {
    itemAmount: fees === null ? undefined : nairaShort(fees.itemAmountMinor),
    proceeds: fees === null ? undefined : nairaShort(fees.sellerProceedsMinor),
    counterparty:
      trade.counterparty === undefined || trade.counterparty === null
        ? undefined
        : partyName(trade.counterparty),
  });
  return (
    <>
      {copy.hero && (
        <StatusHero tone="success" as="h2" title={copy.hero.title}>
          {copy.hero.body}
        </StatusHero>
      )}
      <AutoReleaseNotice trade={trade} />
      <ItemSummary trade={trade} />
      {/* SEAM(F-038): "Leave a review", and the count of trades on the Trust Profile (F-016). */}
      <ViewTheResult id={trade.id} />
      <FurtherViews trade={trade} />
    </>
  );
}

/** A trade ended by a decision or a refund: the outcome, and that the money is confirmed separately. */
export function Outcome({
  trade,
  role,
  status,
}: BodyProps & {
  status: 'RESOLVED_RELEASED' | 'RESOLVED_REFUNDED';
}): React.JSX.Element {
  const copy = stateCopy(status satisfies WorkspaceStatus, role);
  return (
    <>
      {copy.hero && (
        <StatusHero tone="success" as="h2" title={copy.hero.title}>
          {copy.hero.body}
        </StatusHero>
      )}
      {copy.banner && <BannerView banner={copy.banner} />}
      <ItemSummary trade={trade} />
      <FurtherViews trade={trade} />
    </>
  );
}
