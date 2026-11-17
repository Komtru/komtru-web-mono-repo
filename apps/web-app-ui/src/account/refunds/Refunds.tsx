'use client';

import type { Refund } from '@komtru/api-client';
import { useMyRefunds } from '@komtru/api-client/react';
import {
  Button,
  EmptyState,
  NoteBanner,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  VersionTimeline,
  type VersionStep,
} from '@komtru/ui-kit';
import { feeTreatmentWords } from '../../trade/cancel/words';
import { naira, nairaShort, whenLabel } from '../../trade/format';
import { Loading, LoadProblem } from '../states';

/** What the journey says of a refund, from its status and the dates the ledger recorded, and nothing else. */
export function refundSteps(refund: Refund): VersionStep[] {
  const requested: VersionStep = {
    id: 'requested',
    title: 'Refund requested',
    detail: whenLabel(refund.requestedAt),
    state: 'done',
  };
  switch (refund.status) {
    case 'PROCESSED':
      return [
        requested,
        { id: 'sent', title: 'Sent back', detail: 'To your original payment method', state: 'done' },
        {
          id: 'back',
          title: 'Back with you',
          ...(refund.completedAt === null ? {} : { detail: whenLabel(refund.completedAt) }),
          state: 'done',
        },
      ];
    case 'FAILED':
    case 'NEEDS_REVIEW':
      return [
        requested,
        { id: 'sent', title: 'Sent back', detail: 'To your original payment method', state: 'done' },
        {
          id: 'held',
          title: 'Held while we check it',
          detail: refund.failureReason ?? 'The money is held, not lost.',
          state: 'active',
        },
      ];
    default:
      return [
        requested,
        {
          id: 'sent',
          title: 'On its way back',
          detail: 'To your original payment method',
          state: 'active',
        },
        { id: 'back', title: 'Back with you', state: 'pending' },
      ];
  }
}

/**
 * SP-M12: a refund shown as a journey with its dates, so there is no need to ask. It is built over what the ledger
 * returns for the buyer's own refunds (`GET /me/refunds`) and draws nothing it does not say: the reference's return
 * handover, the seller's check, the bank account and "usually within 1 day" are not things the platform records or
 * promises, so there is no "Due in 2 days" and no arrival time here. Money is shown as the ledger sent it.
 */
export function Refunds(): React.JSX.Element {
  const list = useMyRefunds();
  const header = (
    <ScreenHeader title="Where’s my refund?" backHref="/account" backLabel="Back to your account" />
  );

  if (list.isPending) {
    return (
      <ScreenColumn>
        {header}
        <Loading label="Loading your refunds" />
      </ScreenColumn>
    );
  }
  if (list.data === undefined) {
    return (
      <ScreenColumn>
        {header}
        <LoadProblem what="your refunds" onRetry={() => void list.refetch()} />
      </ScreenColumn>
    );
  }

  const refunds = list.data.pages.flatMap((page) => page.items);
  return (
    <ScreenColumn>
      {header}
      {refunds.length === 0 ? (
        <EmptyState
          title="No refunds"
          body="A refund appears here if a Trade you paid for is cancelled or refunded, and you can follow it from the day it’s requested."
          action={
            <Button asChild variant="secondary">
              <a href="/trades">See your Trades</a>
            </Button>
          }
        />
      ) : (
        <>
          {refunds.map((refund) => (
            <RefundCard key={refund.id} refund={refund} />
          ))}
          {list.isFetchNextPageError && (
            <RiskBanner title="Older refunds didn’t load">
              <Button type="button" variant="ghost" onClick={() => void list.fetchNextPage()}>
                Try again
              </Button>
            </RiskBanner>
          )}
          {list.hasNextPage && !list.isFetchNextPageError && (
            <Button
              type="button"
              variant="secondary"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? 'Loading…' : 'Show older refunds'}
            </Button>
          )}
          <NoteBanner>
            Refunds go back to the payment method you paid with. How long your bank takes after that is up to
            your bank, so we don’t give a time.
          </NoteBanner>
        </>
      )}
    </ScreenColumn>
  );
}

function RefundCard({ refund }: { refund: Refund }): React.JSX.Element {
  const held = refund.status === 'FAILED' || refund.status === 'NEEDS_REVIEW';
  const feeLine =
    refund.feeAmountMinor !== '0'
      ? `Buyer protection fee ${nairaShort(refund.feeAmountMinor)} · ${feeTreatmentWords(refund.buyerProtectionFeeTreatment)}`
      : refund.buyerProtectionFeeTreatment !== 'REFUND'
        ? `Buyer protection fee · ${feeTreatmentWords(refund.buyerProtectionFeeTreatment)}`
        : undefined;
  return (
    <article
      aria-label={`Refund ${refund.reference}`}
      className="mb-[16px] rounded-lg border border-solid border-border-hairline bg-surface-primary p-[16px]"
    >
      <p className="m-0 font-mono text-[24px] font-semibold">{nairaShort(refund.amountMinor)}</p>
      <p className="mt-[2px] mb-[14px] text-[11.5px] text-slate">
        Refund {refund.reference} · item {naira(refund.itemAmountMinor)}
      </p>
      <VersionTimeline aria-label="Where this refund is" steps={refundSteps(refund)} />
      {feeLine !== undefined && <p className="mt-[12px] mb-0 text-[11.5px] text-slate">{feeLine}</p>}
      {held && (
        <p className="mt-[8px] mb-0 text-[11.5px] text-risk-on-soft">Quote {refund.reference} to support.</p>
      )}
      <Button asChild variant="ghost" className="mt-[8px]">
        <a href={`/trade/${refund.tradeId}`}>View the Trade</a>
      </Button>
    </article>
  );
}
