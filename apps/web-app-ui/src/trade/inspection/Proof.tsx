'use client';

// Z4's two columns of evidence. The seller's pre-shipment media come from private storage as short-lived signed
// URLs (read per file, never kept in the page), and the delivery evidence is what the platform recorded.
import { useFileUrl, type useInspection } from '@komtru/api-client/react';
import { Skeleton, TermList, TermRow } from '@komtru/ui-kit';
import { whenLabel } from '../format';

type Read = NonNullable<ReturnType<typeof useInspection>['data']>;

function ProofTile({ fileId, label }: { fileId: string; label: string }): React.JSX.Element {
  const file = useFileUrl(fileId);
  const frame =
    'aspect-square w-full overflow-hidden rounded-md border border-solid border-border-hairline bg-surface-secondary object-cover';
  if (file.isPending) return <Skeleton width="full" lines={3} />;
  if (file.isError) {
    return (
      <p
        role="alert"
        className="flex aspect-square items-center justify-center rounded-md bg-surface-secondary p-[8px] text-center text-[11px] text-risk-on-soft"
      >
        <span>
          {label} didn’t load.{' '}
          <button type="button" className="underline" onClick={() => void file.refetch()}>
            Try again
          </button>
        </span>
      </p>
    );
  }
  return file.data.contentType.startsWith('video/') ? (
    <video src={file.data.url} controls className={frame} aria-label={label} />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not an optimisable asset
    <img src={file.data.url} alt={label} className={frame} />
  );
}

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
              <ProofTile fileId={item.fileId} label={`Seller’s proof ${String(index + 1)}`} />
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
