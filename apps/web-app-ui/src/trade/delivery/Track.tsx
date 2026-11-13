'use client';

import type { TradeView } from '@komtru/api-client';
import { useDeliveryDeadline, useInspection } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  InfoCard,
  InfoRow,
  SectionLabel,
  Skeleton,
  VersionTimeline,
  type VersionStep,
} from '@komtru/ui-kit';
import { whenLabel } from '../format';
import { pickupHref } from '../workspace-state';
import { Frame, Refusal, TradeGate, tradeHref } from './parts';

const TITLE = 'Track Order';

type Stage = 'NOT_HANDED_OVER' | 'IN_TRANSIT' | 'REPORTED' | 'RECEIVED';

/** Where the parcel is, from the trade's status alone: the platform records handover and receipt, not a route. */
const STAGE: Record<string, Stage> = {
  FUNDED: 'NOT_HANDED_OVER',
  SHIPPED: 'IN_TRANSIT',
  UNCONFIRMED_DELIVERY: 'REPORTED',
  INSPECTION: 'RECEIVED',
  DISPUTED: 'RECEIVED',
  COMPLETED: 'RECEIVED',
  SETTLED: 'RECEIVED',
};

/**
 * CWT-S10 (AB1): the buyer, and the seller too, follow the parcel. Self-arranged delivery has no hub, so the
 * custody timeline is Seller, Courier, You. What is shown is what the platform has recorded (waybill, the time
 * of handover, the vehicle, the delivery deadline); courier tracking events are not available and none are drawn.
 */
export function Track({ id }: { id: string }): React.JSX.Element {
  return (
    <TradeGate id={id} title={TITLE}>
      {(trade) => <Tracking trade={trade} />}
    </TradeGate>
  );
}

function Tracking({ trade }: { trade: TradeView }): React.JSX.Element {
  const stage = STAGE[trade.status];
  const buyer = trade.yourRole === 'BUYER';
  const shipped = stage === 'IN_TRANSIT' || stage === 'REPORTED' || stage === 'RECEIVED';
  const inspection = useInspection(trade.id, shipped);
  const deadline = useDeliveryDeadline(trade.id, stage === 'IN_TRANSIT');
  if (stage === undefined) {
    return <Refusal id={trade.id} title={TITLE} why="There is nothing to track on this trade." />;
  }

  const record = inspection.data?.deliveryEvidence.selfArranged;
  const steps: VersionStep[] = [
    {
      id: 'seller',
      title: buyer ? 'Seller' : 'You',
      detail: stage === 'NOT_HANDED_OVER' ? 'Preparing the handover' : 'Handover complete',
      state: stage === 'NOT_HANDED_OVER' ? 'active' : 'done',
    },
    {
      id: 'courier',
      title: 'Courier',
      detail:
        stage === 'NOT_HANDED_OVER' ? 'Not collected' : stage === 'IN_TRANSIT' ? 'In transit' : 'Delivered',
      state: stage === 'NOT_HANDED_OVER' ? 'pending' : stage === 'IN_TRANSIT' ? 'active' : 'done',
    },
    {
      id: 'buyer',
      title: buyer ? 'You' : 'Buyer',
      detail:
        stage === 'RECEIVED'
          ? 'Delivery confirmed'
          : stage === 'REPORTED'
            ? 'Waiting to confirm'
            : 'Not received',
      state: stage === 'RECEIVED' ? 'done' : stage === 'REPORTED' ? 'active' : 'pending',
    },
  ];
  const headline =
    stage === 'NOT_HANDED_OVER'
      ? 'Not handed over yet'
      : stage === 'IN_TRANSIT'
        ? 'In transit'
        : stage === 'REPORTED'
          ? 'Delivery reported'
          : 'Delivered';

  return (
    <Frame title={TITLE} id={trade.id}>
      {shipped && inspection.isPending ? (
        <Skeleton width="full" lines={3} />
      ) : shipped && inspection.isError ? (
        <p role="alert" className="mb-[14px] text-[12px] text-risk-on-soft">
          We couldn&apos;t load the shipment details.{' '}
          <button type="button" className="underline" onClick={() => void inspection.refetch()}>
            Try again
          </button>
        </p>
      ) : (
        <InfoCard aria-label="Shipment">
          <InfoRow
            title={headline}
            detail={
              record === undefined || record === null
                ? 'No tracking recorded yet'
                : `Tracking ${record.waybillNumber}`
            }
          />
          {record !== undefined && record !== null && (
            <InfoRow title="Last update" detail={`Handed to the courier · ${whenLabel(record.shippedAt)}`} />
          )}
          {record?.vehiclePlate !== undefined && <InfoRow title="Vehicle" detail={record.vehiclePlate} />}
          {stage === 'IN_TRANSIT' &&
            deadline.data?.deadline !== undefined &&
            deadline.data.deadline !== null && (
              <InfoRow title="Expected" detail={`By ${whenLabel(deadline.data.deadline.dueAt)}`} />
            )}
        </InfoCard>
      )}
      <SectionLabel>Custody timeline</SectionLabel>
      <VersionTimeline aria-label="Custody timeline" steps={steps} />
      <ActionStack className="mt-[16px]">
        <Button asChild>
          <a href={pickupHref(trade.id)}>Delivery details</a>
        </Button>
        <Button asChild variant="secondary">
          <a href={tradeHref(trade.id)}>Back to trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
