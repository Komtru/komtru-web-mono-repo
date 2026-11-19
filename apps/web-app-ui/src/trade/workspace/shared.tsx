'use client';

// What more than one state of the workspace draws: the way out of every overview, the money and fulfilment
// rows, a deadline read from its own route, the fee list, and a banner from `workspace-copy`.
import type { TradeView } from '@komtru/api-client';
import { createContext, useContext } from 'react';
import {
  ActionStack,
  Button,
  CountdownStrip,
  NoteBanner,
  ReadyBanner,
  SectionLabel,
  Skeleton,
  TermList,
  TermRow,
  WarnBanner,
} from '@komtru/ui-kit';
import { addressLine, hoursLabel, naira, nairaShort, whenLabel } from '../format';
import { BACK_TO_TRADES } from '../parts';
import type { Banner } from '../workspace-copy';
import { tabHref, type TradeRole } from '../workspace-state';

/**
 * True while the wide workspace's context rail is drawing the money (F-069, F-073). The bodies keep their own money
 * rows for the phone; with the rail beside them, the same figures must not be drawn twice.
 */
export const RailShowsMoney = createContext(false);

export interface BodyProps {
  trade: TradeView;
  role: TradeRole;
}

/** A banner as `workspace-copy` words it; an empty title draws none. */
export function BannerView({ banner }: { banner: Banner }): React.JSX.Element {
  const title = banner.title === '' ? {} : { title: banner.title };
  switch (banner.tone) {
    case 'ready':
      return <ReadyBanner {...title}>{banner.body}</ReadyBanner>;
    case 'warn':
      return <WarnBanner {...title}>{banner.body}</WarnBanner>;
    case 'note':
      return <NoteBanner {...title}>{banner.body}</NoteBanner>;
  }
}

/** The links every overview ends with: the agreement it follows and the record of what happened. */
export function FurtherViews({ trade }: { trade: TradeView }): React.JSX.Element {
  return (
    <ActionStack>
      <Button asChild variant="secondary">
        <a href={tabHref(trade.id, 'terms')}>View agreed terms</a>
      </Button>
      <Button asChild variant="secondary">
        <a href={tabHref(trade.id, 'activity')}>View activity</a>
      </Button>
      {BACK_TO_TRADES}
    </ActionStack>
  );
}

/** A step that belongs to a later feature, said plainly with no control (SEAM: replaced by that feature). */
export function NotInTheAppYet({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="mb-[14px] text-[11.5px] leading-[1.6] text-trust-gray">{children}</p>;
}

/** The rows of the money, in the reader's terms, straight from the trade's own fee snapshot. */
export function MoneyTerms({ trade, role, held }: BodyProps & { held: string }): React.JSX.Element | null {
  const { fees } = trade;
  if (fees === null) return null;
  return (
    <TermList aria-label="Money">
      {role === 'BUYER' ? (
        <>
          <TermRow label="You paid">{nairaShort(fees.buyerTotalMinor)}</TermRow>
          <TermRow label="Seller payout">{held}</TermRow>
        </>
      ) : (
        <>
          <TermRow label="Protected funds">Confirmed · {nairaShort(fees.itemAmountMinor)}</TermRow>
          <TermRow label="Your payout">
            {nairaShort(fees.sellerProceedsMinor)} · {held}
          </TermRow>
        </>
      )}
    </TermList>
  );
}

/** The money, under its own heading, for the phone's bodies. The wide rail draws it instead (`RailShowsMoney`). */
export function MoneyRows({ trade, role, held }: BodyProps & { held: string }): React.JSX.Element | null {
  const inRail = useContext(RailShowsMoney);
  if (trade.fees === null || inRail) return null;
  return (
    <>
      <SectionLabel>Money</SectionLabel>
      <MoneyTerms trade={trade} role={role} held={held} />
    </>
  );
}

/** What was agreed about getting the item there, from the trade's own terms. */
export function Fulfilment({ trade }: { trade: TradeView }): React.JSX.Element | null {
  const { terms } = trade;
  if (terms === null) return null;
  return (
    <>
      <SectionLabel>Fulfilment</SectionLabel>
      <TermList aria-label="Terms of this trade">
        {terms.deliveryAddress !== null && (
          <TermRow label="Delivery to">{addressLine(terms.deliveryAddress)}</TermRow>
        )}
        {terms.shipsFromAddress !== null && (
          <TermRow label="Ships from">{addressLine(terms.shipsFromAddress)}</TermRow>
        )}
        <TermRow label="Inspection">{hoursLabel(terms.inspectionWindowHours)}</TermRow>
      </TermList>
    </>
  );
}

/**
 * A deadline read from its own route: shown when there, said plainly when it cannot be read. `label` is the
 * line before the date ("Ship by"); `noun` names the thing for the error ("delivery deadline"), because a
 * label is a phrase and does not read as a noun in "We couldn't load the ...".
 */
export function Deadline({
  label,
  noun,
  query,
  at,
}: {
  label: string;
  noun: string;
  query: { isPending: boolean; isError: boolean; refetch: () => unknown };
  at: string | null | undefined;
}): React.JSX.Element | null {
  if (query.isPending) return <Skeleton width="full" lines={1} />;
  if (query.isError) {
    return (
      <p role="alert" className="mb-[14px] text-[12px] text-risk-on-soft">
        We couldn&apos;t load the {noun}.{' '}
        <button type="button" className="underline" onClick={() => void query.refetch()}>
          Try again
        </button>
      </p>
    );
  }
  return at === null || at === undefined ? null : (
    <CountdownStrip>
      {label} · {whenLabel(at)}
    </CountdownStrip>
  );
}

/** What the trade comes to for the reader: the buyer's total, or what the seller receives. */
export function FeeList({ trade, role }: BodyProps): React.JSX.Element | null {
  const { fees } = trade;
  if (fees === null) return null;
  return (
    <TermList aria-label="What this comes to">
      <TermRow label="Item price">{naira(fees.itemAmountMinor)}</TermRow>
      {role === 'BUYER' ? (
        <>
          <TermRow label="Buyer protection fee">{naira(fees.buyerProtectionFeeMinor)}</TermRow>
          <TermRow label="You pay">
            <b className="text-midnight-text">{naira(fees.buyerTotalMinor)}</b>
          </TermRow>
        </>
      ) : (
        <TermRow label="You receive">
          <b className="text-midnight-text">{naira(fees.sellerProceedsMinor)}</b>
        </TermRow>
      )}
    </TermList>
  );
}
