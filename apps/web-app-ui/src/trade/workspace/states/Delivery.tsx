'use client';

import type { TradeView } from '@komtru/api-client';
import { useInspection } from '@komtru/api-client/react';
import { InfoCard, InfoRow, SectionLabel, Skeleton, TermList, TermRow } from '@komtru/ui-kit';
import { hoursLabel, whenLabel } from '../../format';
import { stateCopy } from '../../workspace-copy';
import { BannerView, FurtherViews, NotInTheAppYet, type BodyProps } from '../shared';

/** The shipment, as far as the platform records it: when it was handed over and the waybill. */
function Shipment({ trade }: { trade: TradeView }): React.JSX.Element | null {
  const inspection = useInspection(trade.id, true);
  const shipped = inspection.data?.deliveryEvidence.selfArranged;
  if (inspection.isPending) return <Skeleton width="full" lines={2} />;
  if (inspection.isError) {
    return (
      <p role="alert" className="mb-[14px] text-[12px] text-risk-on-soft">
        We couldn&apos;t load the shipment details.{' '}
        <button type="button" className="underline" onClick={() => void inspection.refetch()}>
          Try again
        </button>
      </p>
    );
  }
  if (shipped === null || shipped === undefined) return null;
  return (
    <InfoCard aria-label="Shipment">
      <InfoRow title="Dispatched" detail={`${whenLabel(shipped.shippedAt)} · arranged by the seller`} />
      <InfoRow title="Waybill" detail={shipped.waybillNumber} />
    </InfoCard>
  );
}

/** CWT-03: handed over, on its way. */
export function InTransit({ trade, role }: BodyProps): React.JSX.Element {
  const copy = stateCopy('SHIPPED', role);
  return (
    <>
      {copy.banner && <BannerView banner={copy.banner} />}
      <Shipment trade={trade} />
      <SectionLabel>What happens at arrival</SectionLabel>
      <TermList aria-label="At arrival">
        <TermRow label="Funds">Protected</TermRow>
        <TermRow label={copy.payoutLabel ?? 'Payout'}>Held until settlement</TermRow>
        <TermRow label="Inspection">
          {trade.terms === null
            ? 'Starts on delivery'
            : `${hoursLabel(trade.terms.inspectionWindowHours)} from delivery`}
        </TermRow>
      </TermList>
      {/* SEAM(F-026/F-027): delivery tracking detail, "Report delivery" and "Confirm you have it". */}
      <FurtherViews trade={trade} />
    </>
  );
}

/** The seller reported it delivered; the buyer has not said whether it arrived. */
export function DeliveryToConfirm({ trade, role }: BodyProps): React.JSX.Element {
  const copy = stateCopy('UNCONFIRMED_DELIVERY', role, {
    grace: trade.terms === null ? undefined : hoursLabel(trade.terms.deliveryGraceHours),
  });
  return (
    <>
      {copy.banner && <BannerView banner={copy.banner} />}
      <Shipment trade={trade} />
      {/* SEAM(F-027): the buyer's "Confirm delivery" goes here. */}
      {copy.seam !== undefined && <NotInTheAppYet>{copy.seam}</NotInTheAppYet>}
      <FurtherViews trade={trade} />
    </>
  );
}
