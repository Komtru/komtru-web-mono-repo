'use client';

// What the buyer's four stages and the seller's three share: the stage header and the agreement preview that
// CT-B4, CT-B9 and CT-B10 draw the same way ("both parties see the same agreement").
import { TermList, TermRow } from '@komtru/ui-kit';
import { useEffect, useRef } from 'react';
import { hoursLabel, naira } from '../format';
import { promiseLabel } from './request';

export const BUYER_STAGES = ['About', 'Item & delivery', 'Terms', 'Review'] as const;

/**
 * The rail under the header: one bar per stage, filled up to the one the person is on, each named beneath it, as the
 * v2 buyer and seller flows draw it. The kit's numbered `Stepper` is v1's rail and is wider than a phone with four
 * named stages, so these screens draw the v2 one.
 */
export function StageHeader({
  stages,
  current,
  heading,
}: {
  stages: readonly string[];
  current: number;
  heading: string;
}): React.JSX.Element {
  // Moving to another stage moves focus to the rail, which names it, so a keyboard or screen-reader user is told
  // where they are instead of being left on a button that no longer exists.
  const rail = useRef<HTMLOListElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    rail.current?.focus();
  }, [current]);
  return (
    <ol
      ref={rail}
      tabIndex={-1}
      aria-label={`${heading}, step ${String(current + 1)} of ${String(stages.length)}`}
      className="m-0 mb-[18px] flex list-none gap-[6px] p-0 outline-none"
    >
      {stages.map((stage, index) => (
        <li
          key={stage}
          {...(index === current ? { 'aria-current': 'step' as const } : {})}
          className="min-w-0 flex-1"
        >
          <span
            aria-hidden
            className={`mb-[6px] block h-[4px] rounded-[2px] ${index === current ? 'bg-trust-indigo' : index < current ? 'bg-trust-emerald' : 'bg-border-hairline'}`}
          />
          <span
            className={`block truncate text-[9px] font-[650] ${index === current ? 'text-midnight-text' : 'text-slate'}`}
          >
            {stage}
          </span>
        </li>
      ))}
    </ol>
  );
}

const WAITING = <span className="font-semibold text-warning-on-soft">Waiting</span>;

export interface AgreementProps {
  /** The name on the other side of the terms. The row is labelled "Seller" unless `partyLabel` says otherwise. */
  sellerName: string;
  /** "Buyer" when the seller is the one reading (CT-S4). */
  partyLabel?: 'Seller' | 'Buyer';
  /** The seller's address as the terms carry it, when there is one. */
  sellerLocation?: string | undefined;
  /** The item's description once the seller gave it, or `undefined` while it waits. */
  itemDetails: string | undefined;
  deliveryLine: React.ReactNode;
  collectionPhone?: string | undefined;
  /** Whole kobo digit strings from the platform, or `undefined` while the seller has not said. */
  deliveryChargeMinor: string | undefined;
  deliveryPromise: string | undefined;
  inspectionHours: number | undefined;
  categoryName: string | undefined;
  fees:
    { itemMinor: string; protectionFeeMinor: string; totalMinor: string; proceedsMinor?: string } | undefined;
  /** CT-B4 and CT-B9 have no total to give until the seller's part is in, or the platform has not computed it. */
  totalNote?: string;
}

/** The terms and the money of one agreement. Nothing here adds money: every figure is the platform's. */
export function Agreement({
  sellerName,
  partyLabel = 'Seller',
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
        <TermRow checked label={partyLabel}>
          {sellerName}
        </TermRow>
        {sellerLocation !== undefined && (
          <TermRow checked label="Seller location">
            {sellerLocation}
          </TermRow>
        )}
        <TermRow checked label="Item details">
          {itemDetails ?? WAITING}
        </TermRow>
        <TermRow checked label="Delivery">
          {deliveryLine}
        </TermRow>
        {collectionPhone !== undefined && (
          <TermRow checked label="Collection phone">
            {collectionPhone}
          </TermRow>
        )}
        <TermRow checked label="Delivery cost">
          {deliveryChargeMinor === undefined ? WAITING : naira(deliveryChargeMinor)}
        </TermRow>
        <TermRow checked label="Delivery promise">
          {deliveryPromise === undefined ? WAITING : (promiseLabel(deliveryPromise) ?? deliveryPromise)}
        </TermRow>
        {inspectionHours !== undefined && (
          <TermRow checked label="Inspection">
            {hoursLabel(inspectionHours)} · {standard}
          </TermRow>
        )}
        <TermRow checked label="Cancellation">
          Free before shipment
        </TermRow>
        <TermRow checked label="Refund">
          {categoryName === undefined ? 'Per Komtru policy' : `Per Komtru ${categoryName} policy`}
        </TermRow>
      </TermList>
      {fees !== undefined && (
        <>
          <TermList
            aria-label={fees.proceedsMinor === undefined ? 'What you pay' : 'What is paid'}
            className="mt-[12px] border-t border-solid border-border-hairline"
          >
            <TermRow label="Item price">{naira(fees.itemMinor)}</TermRow>
            <TermRow label="Buyer Protection Fee">{naira(fees.protectionFeeMinor)}</TermRow>
            <TermRow label="Total due on funding">
              <strong className="text-midnight-text">{naira(fees.totalMinor)}</strong>
            </TermRow>
            {fees.proceedsMinor !== undefined && (
              <TermRow label="You receive when the trade completes">{naira(fees.proceedsMinor)}</TermRow>
            )}
          </TermList>
          {totalNote !== undefined && (
            <p className="mt-[6px] text-[11px] leading-[1.5] text-slate">{totalNote}</p>
          )}
        </>
      )}
    </>
  );
}
