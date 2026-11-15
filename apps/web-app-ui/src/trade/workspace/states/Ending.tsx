'use client';

import { SectionLabel, StatusHero, TermList, TermRow } from '@komtru/ui-kit';
import { AutoReleaseNotice } from '../../cancel/AutoReleaseNotice';
import { nairaShort, partyName } from '../../format';
import { ItemSummary } from '../../parts';
import { stateCopy } from '../../workspace-copy';
import type { WorkspaceStatus } from '../../workspace-state';
import { BannerView, FurtherViews, MoneyRows, NotInTheAppYet, type BodyProps } from '../shared';

/** CWT-05: an issue was reported and the money stays where it is. */
export function Disputed({ trade, role }: BodyProps): React.JSX.Element {
  const copy = stateCopy('DISPUTED', role);
  return (
    <>
      {copy.banner && <BannerView banner={copy.banner} />}
      <MoneyRows trade={trade} role={role} held={copy.payoutHeld ?? ''} />
      {/* SEAM(F-032): the case reference, its stage, the evidence deadline and "Submit evidence". */}
      {copy.seam !== undefined && <NotInTheAppYet>{copy.seam}</NotInTheAppYet>}
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
