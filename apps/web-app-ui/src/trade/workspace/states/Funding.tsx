'use client';

import { useDeliveryDeadline } from '@komtru/api-client/react';
import { ActionStack, Button } from '@komtru/ui-kit';
import { stateCopy } from '../../workspace-copy';
import { shipHref } from '../../workspace-state';
import { AwaitingFundingBody } from '../../terms/AwaitingFundingBody';
import { DeliveryTime } from '../DeliveryTime';
import {
  BannerView,
  Deadline,
  Fulfilment,
  FurtherViews,
  MoneyRows,
  NotInTheAppYet,
  type BodyProps,
} from '../shared';

/**
 * CWT-01 and TW-01, and TC-06 before them: the agreement is recorded and nobody has paid. The body is
 * `terms/AwaitingFundingBody`; the buyer is led to fund it (F-024, `/trade/[id]/fund`).
 */
export function AwaitingFunding({ trade, role }: BodyProps): React.JSX.Element {
  return <AwaitingFundingBody trade={trade} role={role} />;
}

/** CWT-02 (and Customer-3's buyer view): paid for, waiting on the seller to ship. */
export function FundsProtected({ trade, role }: BodyProps): React.JSX.Element {
  const deadline = useDeliveryDeadline(trade.id, true);
  const copy = stateCopy('FUNDED', role);
  return (
    <>
      {copy.banner && <BannerView banner={copy.banner} />}
      <Deadline
        label={copy.deadlineLabel ?? 'Ship by'}
        noun="delivery deadline"
        query={deadline}
        at={deadline.data?.deadline?.dueAt}
      />
      <DeliveryTime trade={trade} role={role} />
      <MoneyRows trade={trade} role={role} held={copy.payoutHeld ?? ''} />
      <Fulfilment trade={trade} />
      {role === 'SELLER' && (
        <ActionStack>
          <Button asChild>
            <a href={shipHref(trade.id)}>Ship this order</a>
          </Button>
        </ActionStack>
      )}
      {copy.seam !== undefined && <NotInTheAppYet>{copy.seam}</NotInTheAppYet>}
      <FurtherViews trade={trade} />
    </>
  );
}
