'use client';

import type { TradeView } from '@komtru/api-client';
import { useConfirmDelivery, useInspection } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  InfoCard,
  InfoRow,
  RiskBanner,
  SectionLabel,
  Skeleton,
  TermList,
  TermRow,
} from '@komtru/ui-kit';
import { useState } from 'react';
import { hoursLabel, platformWords, whenLabel } from '../../format';
import { stateCopy } from '../../workspace-copy';
import { DeliveryTime } from '../DeliveryTime';
import { BannerView, FurtherViews, type BodyProps } from '../shared';

/**
 * AB1 / Customer-4: the buyer says they have it. Inspection starts when they do, so it says so before and the
 * trade moves on the moment the platform agrees (the screen then shows the inspection).
 */
function ConfirmDelivery({ trade, label }: { trade: TradeView; label: string }): React.JSX.Element {
  const confirm = useConfirmDelivery();
  const [problem, setProblem] = useState<string | undefined>(undefined);
  return (
    <>
      <p className="mb-[14px] text-[11.5px] leading-[1.6] text-trust-gray">
        Confirm only once the item is in your hands.
        {trade.terms === null
          ? ' Your inspection time starts when you do.'
          : ` Your ${hoursLabel(trade.terms.inspectionWindowHours)} of inspection time starts when you do.`}
      </p>
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        <Button
          type="button"
          disabled={confirm.isPending}
          onClick={() => {
            setProblem(undefined);
            confirm.mutate(trade.id, {
              onError: (error) => {
                setProblem(platformWords(error, 'We couldn’t confirm the delivery. Try again.'));
              },
            });
          }}
        >
          {confirm.isPending ? 'Confirming…' : label}
        </Button>
      </ActionStack>
    </>
  );
}

/** The shipment, as far as the platform records it: when it was handed over, the waybill and the vehicle. */
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
      {shipped.vehiclePlate !== undefined && <InfoRow title="Vehicle" detail={shipped.vehiclePlate} />}
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
      {role === 'BUYER' && <ConfirmDelivery trade={trade} label="Confirm you have it" />}
      <DeliveryTime trade={trade} role={role} />
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
      {role === 'BUYER' && <ConfirmDelivery trade={trade} label="Confirm delivery" />}
      <FurtherViews trade={trade} />
    </>
  );
}
