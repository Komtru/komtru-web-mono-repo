'use client';

import type { TradeView } from '@komtru/api-client';
import { useInspection } from '@komtru/api-client/react';
import { ActionStack, Button, InfoCard, InfoRow, Skeleton } from '@komtru/ui-kit';
import { addressLine, hoursLabel } from '../format';
import { trackHref } from '../workspace-state';
import { Frame, Refusal, TradeGate, tradeHref } from './parts';

const TITLE = 'Delivery Details';
const ON_THE_WAY = ['FUNDED', 'SHIPPED', 'UNCONFIRMED_DELIVERY'];

/**
 * CWT-S11, the self-arranged path. The reference draws Park pickup (a hub, a release PIN, a custody event);
 * Park is out of the MVP (F-062 / T-093), so nothing here mentions a hub or shows a PIN. The seller arranges the
 * delivery to the buyer's address, and the buyer confirms receipt on the trade.
 */
export function Pickup({ id }: { id: string }): React.JSX.Element {
  return (
    <TradeGate id={id} title={TITLE}>
      {(trade) => <Details trade={trade} />}
    </TradeGate>
  );
}

function Details({ trade }: { trade: TradeView }): React.JSX.Element {
  const listening = ON_THE_WAY.includes(trade.status) && trade.status !== 'FUNDED';
  const inspection = useInspection(trade.id, listening);
  if (!ON_THE_WAY.includes(trade.status)) {
    return (
      <Refusal
        id={trade.id}
        title={TITLE}
        why={
          trade.status === 'INSPECTION'
            ? 'This item has been received. Its inspection time is running on the trade.'
            : 'There are no delivery details to show for this trade yet.'
        }
      />
    );
  }
  const buyer = trade.yourRole === 'BUYER';
  const to = trade.terms?.deliveryAddress;
  const record = inspection.data?.deliveryEvidence.selfArranged;
  return (
    <Frame title={TITLE} id={trade.id}>
      <p className="mb-[14px] text-[12.5px] leading-[1.6] text-slate">
        {buyer
          ? 'The seller is arranging this delivery to your address. There is no release PIN: confirm on the trade once the item is in your hands.'
          : 'You are arranging this delivery to the buyer’s address. The buyer confirms on the trade once the item is in their hands.'}
      </p>
      {listening && inspection.isPending ? (
        <Skeleton width="full" lines={2} />
      ) : (
        <InfoCard aria-label="Delivery details">
          {to !== undefined && to !== null && (
            <InfoRow title={buyer ? 'Delivery to you' : 'Delivery to the buyer'} detail={addressLine(to)} />
          )}
          <InfoRow
            title="Arranged by the seller"
            detail={
              record === undefined || record === null
                ? trade.status === 'FUNDED'
                  ? 'Not handed over yet'
                  : 'Waybill not available'
                : `Waybill ${record.waybillNumber}`
            }
          />
        </InfoCard>
      )}
      {listening && inspection.isError && (
        <p role="alert" className="mb-[14px] text-[12px] text-risk-on-soft">
          We couldn&apos;t load the shipment details.{' '}
          <button type="button" className="underline" onClick={() => void inspection.refetch()}>
            Try again
          </button>
        </p>
      )}
      {buyer && trade.terms !== null && (
        <p className="mb-[14px] text-[11.5px] leading-[1.6] text-trust-gray">
          Your {hoursLabel(trade.terms.inspectionWindowHours)} of inspection time starts when you confirm you
          have the item.
        </p>
      )}
      <ActionStack>
        <Button asChild>
          <a href={tradeHref(trade.id)}>Back to trade</a>
        </Button>
        <Button asChild variant="secondary">
          <a href={trackHref(trade.id)}>Track the delivery</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
