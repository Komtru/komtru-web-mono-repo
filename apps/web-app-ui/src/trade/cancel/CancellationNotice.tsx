'use client';

import type { TradeView } from '@komtru/api-client';
import { useCancellation } from '@komtru/api-client/react';
import { NoteBanner } from '@komtru/ui-kit';
import { partyName } from '../format';
import { cancelRequestHref } from '../workspace-state';

/**
 * On a funded trade's overview: a cancellation in progress, from the platform's read of THIS trade. It says a
 * request is waiting (and lets the seller answer it), or that a refund has been requested, so the overview never
 * shows funds as untouched while the platform is already refunding them. It is silent while loading, on a failed
 * read, and when nothing is in progress: the overview works without it.
 */
export function CancellationNotice({ trade }: { trade: TradeView }): React.JSX.Element | null {
  const read = useCancellation(trade.id);
  if (read.data === undefined) return null;
  const { request, refundRequested, actions } = read.data;
  const other =
    trade.counterparty === undefined || trade.counterparty === null
      ? trade.yourRole === 'BUYER'
        ? 'The seller'
        : 'The buyer'
      : partyName(trade.counterparty);

  if (refundRequested) {
    return (
      <NoteBanner title="Refund requested">
        A refund has been requested for this trade. It shows here once it has been processed.
      </NoteBanner>
    );
  }
  if (request?.status !== 'PENDING') return null;
  if (trade.yourRole === 'SELLER' && actions.canRespond) {
    return (
      <NoteBanner title="Cancellation requested">
        {`${other} asked to cancel this trade.`}{' '}
        <a className="font-semibold underline" href={cancelRequestHref(trade.id)}>
          Review the request
        </a>
      </NoteBanner>
    );
  }
  if (trade.yourRole === 'BUYER' && request.requestedByRole === 'BUYER') {
    return (
      <NoteBanner title="Cancellation requested">
        {`You asked to cancel. We’re waiting for ${other} to answer. Your payment stays protected until they do.`}
      </NoteBanner>
    );
  }
  return null;
}
