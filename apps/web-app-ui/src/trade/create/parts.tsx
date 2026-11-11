'use client';

// What the buyer's four stages and the seller's three share: the stage header and the agreement preview that
// CT-B4, CT-B9 and CT-B10 draw the same way ("both parties see the same agreement").
import { Stepper, TermList, TermRow } from '@komtru/ui-kit';
import { hoursLabel, naira } from '../format';
import { promiseLabel } from './request';

export const BUYER_STAGES = ['About', 'Item & delivery', 'Terms', 'Review'] as const;

/** "Start a Trade 2 / 4" and the rail under it. */
export function StageHeader({
  stages,
  current,
  heading,
}: {
  stages: readonly string[];
  current: number;
  heading: string;
}): React.JSX.Element {
  return (
    <>
      <p className="mb-[8px] mt-0 text-[11px] font-semibold text-slate">
        {heading} · {String(current + 1)} / {String(stages.length)}
      </p>
      <Stepper steps={stages} current={current} label={`${heading}, step ${String(current + 1)}`} />
    </>
  );
}

const WAITING = <span className="font-semibold text-warning-on-soft">Waiting</span>;

export interface AgreementProps {
  sellerName: string;
  /** The seller's address as the terms carry it, when there is one. */
  sellerLocation?: string | undefined;
  /** The item's description once the seller gave it, or `undefined` while it waits. */
  itemDetails: string | undefined;
  deliveryLine: string;
  collectionPhone?: string | undefined;
  /** Whole kobo digit strings from the platform, or `undefined` while the seller has not said. */
  deliveryChargeMinor: string | undefined;
  deliveryPromise: string | undefined;
  inspectionHours: number | undefined;
  categoryName: string | undefined;
  fees: { itemMinor: string; protectionFeeMinor: string; totalMinor: string } | undefined;
  /** CT-B4 and CT-B9 have no total to give until the seller's part is in, or the platform has not computed it. */
  totalNote?: string;
}

/** The terms and the money of one agreement. Nothing here adds money: every figure is the platform's. */
export function Agreement({
  sellerName,
  sellerLocation,
  itemDetails,
  deliveryLine,
  collectionPhone,
  deliveryChargeMinor,
  deliveryPromise,
  inspectionHours,
  categoryName,
  fees,
  totalNote,
}: AgreementProps): React.JSX.Element {
  const standard = categoryName === undefined ? 'Trade Standard' : `${categoryName} standard`;
  return (
    <>
      <h2 className="mb-[6px] mt-[16px] text-[12px] font-semibold uppercase tracking-[.06em] text-slate">
        Terms
      </h2>
      <TermList aria-label="Terms of this trade">
        <TermRow label="Seller">{sellerName}</TermRow>
        {sellerLocation !== undefined && <TermRow label="Seller location">{sellerLocation}</TermRow>}
        <TermRow label="Item details">{itemDetails ?? WAITING}</TermRow>
        <TermRow label="Delivery">{deliveryLine}</TermRow>
        {collectionPhone !== undefined && <TermRow label="Collection phone">{collectionPhone}</TermRow>}
        <TermRow label="Delivery cost">
          {deliveryChargeMinor === undefined ? WAITING : naira(deliveryChargeMinor)}
        </TermRow>
        <TermRow label="Delivery promise">
          {deliveryPromise === undefined ? WAITING : (promiseLabel(deliveryPromise) ?? deliveryPromise)}
        </TermRow>
        {inspectionHours !== undefined && (
          <TermRow label="Inspection">
            {hoursLabel(inspectionHours)} · {standard}
          </TermRow>
        )}
        <TermRow label="Cancellation">Free before shipment</TermRow>
        <TermRow label="Refund">
          {categoryName === undefined ? 'Per Komtru policy' : `Per Komtru ${categoryName} policy`}
        </TermRow>
      </TermList>
      {fees !== undefined && (
        <>
          <TermList
            aria-label="What you pay"
            className="mt-[12px] border-t border-solid border-border-hairline"
          >
            <TermRow label="Item price">{naira(fees.itemMinor)}</TermRow>
            <TermRow label="Buyer Protection Fee">{naira(fees.protectionFeeMinor)}</TermRow>
            <TermRow label="Total due on funding">
              <strong className="text-midnight-text">{naira(fees.totalMinor)}</strong>
            </TermRow>
          </TermList>
          {totalNote !== undefined && (
            <p className="mt-[6px] text-[11px] leading-[1.5] text-slate">{totalNote}</p>
          )}
        </>
      )}
    </>
  );
}
