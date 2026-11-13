'use client';

// Z4's two columns of evidence. The seller's pre-shipment media come from private storage as short-lived signed
// URLs (read per file, never kept in the page), and the delivery evidence is what the platform recorded.
import type { useInspection } from '@komtru/api-client/react';
import { TermList, TermRow } from '@komtru/ui-kit';
import { whenLabel } from '../format';
import { FileTile } from '../proof/MediaGrid';

type Read = NonNullable<ReturnType<typeof useInspection>['data']>;

/** "Seller's proof — before shipping": the media the seller attached when they accepted. */
export function SellerProof({ read, seller }: { read: Read; seller: string }): React.JSX.Element {
  const media = read.sellerProof?.media ?? [];
  return (
    <section aria-label="Seller's proof">
      <p className="mb-[8px] text-[11.5px] leading-[1.6] text-slate">
        {seller}’s own photos, taken before shipment. Compare them against what actually arrived.
      </p>
      {media.length === 0 ? (
        <p className="mb-[14px] text-[12px] text-slate">No proof photos were attached to this trade.</p>
      ) : (
        <ul className="mb-[14px] grid list-none grid-cols-3 gap-[8px] p-0">
          {media.map((item, index) => (
            <li key={item.fileId}>
              <FileTile fileId={item.fileId} label={`Seller’s proof ${String(index + 1)}`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const SIGNAL: Record<string, string> = {
  SELLER_SELF_REPORT: 'Reported delivered by the seller',
  BUYER_CONFIRMATION: 'Confirmed by you',
};

/** "Delivery — what you received": the platform's own record of the hand-over. */
export function DeliveryEvidence({
  read,
  deliveredTo,
}: {
  read: Read;
  deliveredTo: string | undefined;
}): React.JSX.Element {
  const shipped = read.deliveryEvidence.selfArranged;
  const signals = read.deliveryEvidence.signals ?? [];
  return (
    <TermList aria-label="Delivery evidence">
      {deliveredTo !== undefined && <TermRow label="Delivered to">{deliveredTo}</TermRow>}
      {shipped !== null && (
        <>
          <TermRow label="Dispatched">{whenLabel(shipped.shippedAt)} · arranged by the seller</TermRow>
          <TermRow label="Waybill">{shipped.waybillNumber}</TermRow>
          {shipped.vehiclePlate !== undefined && <TermRow label="Vehicle">{shipped.vehiclePlate}</TermRow>}
        </>
      )}
      {signals.map((signal) => (
        <TermRow key={`${signal.source}-${signal.reportedAt ?? ''}`} label="Delivery">
          {SIGNAL[signal.source] ?? 'Delivery recorded'}
          {signal.reportedAt === undefined ? '' : ` · ${whenLabel(signal.reportedAt)}`}
        </TermRow>
      ))}
    </TermList>
  );
}
