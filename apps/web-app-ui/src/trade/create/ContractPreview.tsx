'use client';

import { naira } from '../format';

export interface ContractPreviewProps {
  /** Which side the other party is on: the buyer reads the seller, the seller reads the buyer. */
  partyLabel?: 'Seller' | 'Buyer';
  /** The other party as the person has named them, once known. */
  sellerName?: string | undefined;
  /** What the delivery line says: "Seller to add" until the seller has set a charge. */
  deliveryLine?: string | undefined;
  /** The item as the buyer has typed it, once there is one. */
  itemTitle?: string | undefined;
  /** The item's price in kobo, from the platform's fee snapshot. */
  itemMinor?: string | undefined;
  /** The Buyer Protection Fee in kobo, from the platform's fee snapshot. */
  protectionFeeMinor?: string | undefined;
  /** The inspection window the category's Trade Standard sets, in hours. */
  inspectionHours?: number | undefined;
}

const ROW = 'flex items-baseline justify-between gap-[12px] py-[6px] text-[12.5px] text-midnight-text';

/**
 * "Contract so far" (DX-10, TX-07): what the contract says at this point in the request, beside the stage. Every
 * figure is the platform's, and a figure the platform has not given is shown as waiting, never worked out here.
 */
export function ContractPreview({
  partyLabel = 'Seller',
  sellerName,
  deliveryLine = 'Seller to add',
  itemTitle,
  itemMinor,
  protectionFeeMinor,
  inspectionHours,
}: ContractPreviewProps): React.JSX.Element {
  return (
    <div className="rounded-[14px] border border-border-hairline bg-surface-primary p-[16px]">
      <dl className="m-0">
        <div className={ROW}>
          <dt className="text-slate">{partyLabel}</dt>
          <dd className="m-0 text-right font-semibold">{sellerName ?? 'Not yet named'}</dd>
        </div>
        <div className={ROW}>
          <dt className="text-slate">Item</dt>
          <dd className="m-0 text-right font-semibold">{itemTitle ?? 'Not yet entered'}</dd>
        </div>
        <div className={ROW}>
          <dt className="text-slate">Inspection</dt>
          <dd className="m-0 text-right">
            {inspectionHours === undefined ? 'Waiting' : `${String(inspectionHours)} hours · Komtru policy`}
          </dd>
        </div>
      </dl>
      <dl className="m-0 mt-[10px] border-t border-border-hairline pt-[8px]">
        <div className={ROW}>
          <dt className="text-slate">Item price</dt>
          <dd className="m-0 font-semibold">{itemMinor === undefined ? 'Waiting' : naira(itemMinor)}</dd>
        </div>
        <div className={ROW}>
          <dt className="text-slate">Buyer Protection Fee</dt>
          <dd className="m-0">{protectionFeeMinor === undefined ? 'Waiting' : naira(protectionFeeMinor)}</dd>
        </div>
        <div className={ROW}>
          <dt className="text-slate">Delivery</dt>
          <dd className="m-0">{deliveryLine}</dd>
        </div>
        <div className={`${ROW} mt-[4px] border-t border-border-hairline pt-[8px]`}>
          <dt className="font-semibold">Total due on funding</dt>
          <dd className="m-0 font-semibold">To be confirmed</dd>
        </div>
      </dl>
      <p className="m-0 mt-[8px] text-[11.5px] leading-[1.6] text-trust-gray">
        Updates as you type. Nothing is final until the seller accepts.
      </p>
    </div>
  );
}
